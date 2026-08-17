import { createFile } from '../../lib/mp4box/mp4box.all.mjs';

const MESSAGE_SOURCE = 'instagram-downloader-muxer';
const INSTAGRAM_ORIGIN = 'https://www.instagram.com';

function isAllowedMediaUrl(value) {
    try {
        const url = new URL(value);
        return (
            url.protocol === 'https:' &&
            (url.hostname.endsWith('.fbcdn.net') || url.hostname.endsWith('.cdninstagram.com'))
        );
    } catch {
        return false;
    }
}

function extractTrack(sourceBuffer, kind) {
    return new Promise((resolve, reject) => {
        const file = createFile();
        const samples = [];
        let expectedSamples = 0;
        let resolved = false;
        file.onError = reject;
        file.onReady = (info) => {
            const track = info.tracks.find((item) => (kind === 'video' ? item.video : item.audio));
            if (!track) return reject(new Error(`Missing ${kind} track`));
            expectedSamples = track.nb_samples;
            const sourceTrack = file.getTrackById(track.id);
            const sampleEntry = sourceTrack.mdia.minf.stbl.stsd.entries[0];
            file.onSamples = (id, user, batch) => {
                samples.push(...batch);
                if (!resolved && samples.length >= expectedSamples) {
                    resolved = true;
                    resolve({ track, sampleEntry, samples });
                }
            };
            file.setExtractionOptions(track.id, null, { nbSamples: 1000, rapAlignment: false });
            file.start();
        };
        sourceBuffer.fileStart = 0;
        file.appendBuffer(sourceBuffer);
        file.flush();
    });
}

function getMediaDuration(source) {
    const firstDts = Math.min(...source.samples.map((sample) => sample.dts));
    return Math.max(...source.samples.map((sample) => sample.dts + sample.duration)) - firstDts;
}

function addOutputTrack(output, source, id, movieTimescale) {
    const { track, sampleEntry } = source;
    const isVideo = Boolean(track.video);
    const mediaDuration = getMediaDuration(source);
    return output.addTrack({
        id,
        type: sampleEntry.type,
        timescale: track.timescale,
        duration: Math.round((mediaDuration * movieTimescale) / track.timescale),
        media_duration: mediaDuration,
        width: track.video?.width,
        height: track.video?.height,
        hdlr: isVideo ? 'vide' : 'soun',
        language: track.language || 'und',
        channel_count: track.audio?.channel_count,
        samplerate: track.audio?.sample_rate,
        samplesize: track.audio?.sample_size,
        description_boxes: sampleEntry.boxes,
    });
}

function addCopiedSample(output, trackId, sample) {
    output.addSample(trackId, sample.data, {
        duration: sample.duration,
        cts: sample.cts,
        dts: sample.dts,
        is_sync: sample.is_sync,
        is_leading: sample.is_leading,
        depends_on: sample.depends_on,
        is_depended_on: sample.is_depended_on,
        has_redundancy: sample.has_redundancy,
        degradation_priority: sample.degradation_priority,
        subsamples: sample.subsamples,
    });
}

function createGroupedMediaBlob(output, tracks) {
    output.boxes = output.boxes.filter((box) => box.type !== 'moof' && box.type !== 'mdat');
    output.moofs = [];
    output.mdats = [];
    output.nextMoofNumber = 0;
    const buffers = [output.getBuffer().buffer];
    for (const { id, sampleCount } of tracks) {
        if (!sampleCount) continue;
        const fragment = output.createFragment(id, 0, sampleCount - 1);
        if (!fragment) throw new Error('Failed to create media fragment');
        buffers.push(fragment.buffer);
    }
    return new Blob(buffers, { type: 'video/mp4' });
}

async function downloadTrack(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Media download failed (${response.status})`);
    return response.arrayBuffer();
}

async function createMuxedBlob(videoUrl, audioUrl, reportProgress) {
    reportProgress('Downloading video');
    const videoPromise = downloadTrack(videoUrl);
    const audioPromise = audioUrl ? downloadTrack(audioUrl) : null;
    const videoBuffer = await videoPromise;
    reportProgress(audioPromise ? 'Downloading audio' : 'Preparing video');
    const audioBuffer = audioPromise ? await audioPromise : null;
    reportProgress('Muxing');
    const videoSource = await extractTrack(videoBuffer, 'video');
    const audioSource = audioBuffer ? await extractTrack(audioBuffer, 'audio') : null;
    const output = createFile();
    const movieTimescale = videoSource.track.timescale;
    const videoId = addOutputTrack(output, videoSource, 1, movieTimescale);
    const audioId = audioSource ? addOutputTrack(output, audioSource, 2, movieTimescale) : null;
    for (const sample of videoSource.samples) addCopiedSample(output, videoId, sample);
    if (audioSource) {
        for (const sample of audioSource.samples) addCopiedSample(output, audioId, sample);
    }
    return createGroupedMediaBlob(output, [
        { id: videoId, sampleCount: videoSource.samples.length },
        { id: audioId, sampleCount: audioSource?.samples.length || 0 },
    ]);
}

window.addEventListener('message', async (event) => {
    const data = event.data;
    if (event.source !== parent || event.origin !== INSTAGRAM_ORIGIN) return;
    if (data?.source !== MESSAGE_SOURCE || data.type !== 'mux') return;
    if (!isAllowedMediaUrl(data.videoUrl) || (data.audioUrl && !isAllowedMediaUrl(data.audioUrl))) return;
    const reply = (message) =>
        event.source.postMessage({ source: MESSAGE_SOURCE, requestId: data.requestId, ...message }, INSTAGRAM_ORIGIN);
    try {
        const blob = await createMuxedBlob(data.videoUrl, data.audioUrl, (stage) => reply({ type: 'progress', stage }));
        reply({ type: 'result', blob });
    } catch (error) {
        console.error(error);
        reply({ type: 'error', message: error.message });
    }
});

parent.postMessage({ source: MESSAGE_SOURCE, type: 'ready' }, INSTAGRAM_ORIGIN);
