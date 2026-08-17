import { BoxParser, createFile } from '../../lib/mp4box/mp4box.all.mjs';

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

function runLengthEncode(values) {
    const counts = [];
    const entries = [];
    for (const value of values) {
        if (entries.at(-1) === value) counts[counts.length - 1]++;
        else {
            entries.push(value);
            counts.push(1);
        }
    }
    return { counts, entries };
}

function getMediaChunks(trackId, samples, targetDuration = 1) {
    const chunks = [];
    let start = 0;
    let startTime = samples[0].dts / samples[0].timescale;
    for (let index = 1; index < samples.length; index++) {
        const time = samples[index].dts / samples[index].timescale;
        if (time - startTime < targetDuration) continue;
        chunks.push({ trackId, start, end: index - 1, time: startTime });
        start = index;
        startTime = time;
    }
    chunks.push({ trackId, start, end: samples.length - 1, time: startTime });
    return chunks;
}

function configureSampleTable(output, track, chunks) {
    const stbl = output.getTrackById(track.id).mdia.minf.stbl;
    const durations = runLengthEncode(track.samples.map((sample) => sample.duration));
    stbl.stts.sample_counts = durations.counts;
    stbl.stts.sample_deltas = durations.entries;
    stbl.stsz.sample_size = 0;
    stbl.stsz.sample_sizes = track.samples.map((sample) => sample.data.byteLength);
    stbl.stsc.first_chunk = [];
    stbl.stsc.samples_per_chunk = [];
    stbl.stsc.sample_description_index = [];
    let previousSampleCount = -1;
    chunks.forEach((chunk, index) => {
        const sampleCount = chunk.end - chunk.start + 1;
        if (sampleCount === previousSampleCount) return;
        stbl.stsc.first_chunk.push(index + 1);
        stbl.stsc.samples_per_chunk.push(sampleCount);
        stbl.stsc.sample_description_index.push(1);
        previousSampleCount = sampleCount;
    });
    const syncSamples = track.samples.flatMap((sample, index) => (sample.is_sync ? [index + 1] : []));
    if (syncSamples.length && syncSamples.length !== track.samples.length) {
        const stss = stbl.addBox(new BoxParser.box.stss());
        stss.sample_numbers = syncSamples;
    }
    const compositionOffsets = track.samples.map((sample) => sample.cts - sample.dts);
    if (compositionOffsets.some(Boolean)) {
        const values = runLengthEncode(compositionOffsets);
        const ctts = stbl.addBox(new BoxParser.box.ctts());
        ctts.version = compositionOffsets.some((offset) => offset < 0) ? 1 : 0;
        ctts.sample_counts = values.counts;
        ctts.sample_offsets = values.entries;
    }
    stbl.stco.chunk_offsets = chunks.map(() => 0);
}

function createFlatMediaBlob(output, tracks) {
    output.boxes = output.boxes.filter((box) => box.type !== 'moof' && box.type !== 'mdat');
    output.moov.boxes = output.moov.boxes.filter((box) => box.type !== 'mvex');
    delete output.moov.mvex;
    const tracksById = new Map(tracks.map((track) => [track.id, track]));
    const chunks = tracks
        .flatMap((track) => getMediaChunks(track.id, track.samples))
        .sort((a, b) => a.time - b.time || a.trackId - b.trackId);
    const chunksByTrack = new Map(tracks.map((track) => [track.id, []]));
    let mediaSize = 0;
    for (const chunk of chunks) {
        chunk.dataOffset = mediaSize;
        chunksByTrack.get(chunk.trackId).push(chunk);
        const samples = tracksById.get(chunk.trackId).samples;
        for (let index = chunk.start; index <= chunk.end; index++) mediaSize += samples[index].data.byteLength;
    }
    const mediaData = new Uint8Array(mediaSize);
    let mediaOffset = 0;
    for (const chunk of chunks) {
        const samples = tracksById.get(chunk.trackId).samples;
        for (let index = chunk.start; index <= chunk.end; index++) {
            mediaData.set(samples[index].data, mediaOffset);
            mediaOffset += samples[index].data.byteLength;
        }
    }
    for (const track of tracks) configureSampleTable(output, track, chunksByTrack.get(track.id));
    const mediaDataStart = output.getBuffer().buffer.byteLength + 8;
    for (const track of tracks) {
        const stco = output.getTrackById(track.id).mdia.minf.stbl.stco;
        stco.chunk_offsets = chunksByTrack.get(track.id).map((chunk) => mediaDataStart + chunk.dataOffset);
    }
    output.moofs = [];
    output.mdats = [];
    const mdat = new BoxParser.box.mdat();
    mdat.data = mediaData;
    output.addBox(mdat);
    return new Blob([output.getBuffer().buffer], { type: 'video/mp4' });
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
    const tracks = [{ id: videoId, samples: videoSource.samples }];
    if (audioSource) tracks.push({ id: audioId, samples: audioSource.samples });
    return createFlatMediaBlob(output, tracks);
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
