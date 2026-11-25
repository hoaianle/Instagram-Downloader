// Reporting only: all media still goes through the existing download function.
const downloadSummaryMedia = new WeakMap();

async function fetchMediaWithSummary(item, onProgress) {
    const progressive = item.isVideo && (videoDownloadPreferences.usesProgressive() || !item.dash);
    const blob = await fetchBestMediaBlob(item, onProgress);
    const usedProgressive = progressive || progressiveFallbackBlobs.has(blob);
    downloadSummaryMedia.set(blob, {
        mode: item.isVideo ? (usedProgressive ? 'Progressive' : 'DASH') : 'Image',
        width: usedProgressive ? item.progressiveWidth : item.width,
        height: usedProgressive ? item.progressiveHeight : item.height,
    });
    return blob;
}

function createDownloadSummary(data, media) {
    const report = {
        requestedProgressive: videoDownloadPreferences.usesProgressive(),
        requested: [],
        items: [],
        failed: [],
        errors: [],
        saved: false,
        total: null,
    };
    if (data && media) setDownloadSummaryMedia(report, data, media);
    return report;
}

function setDownloadSummaryMedia(report, data, media) {
    report.total = media.length;
    report.requested = media.map((item, index) => {
        const originalIndex = data.media.findIndex(
            (candidate) => candidate === item || (item.id != null && String(candidate.id) === String(item.id)),
        );
        return { item, label: `Item ${(originalIndex >= 0 ? originalIndex : index) + 1}` };
    });
}

function getDownloadSummaryLabel(report, item) {
    return report.requested.find((entry) => entry.item === item)?.label || 'Media';
}

function recordDownloadSummaryItem(report, item, blob) {
    const details = downloadSummaryMedia.get(blob);
    report.items.push({
        label: getDownloadSummaryLabel(report, item),
        mode: details?.mode || 'Media',
        resolution: details?.width && details?.height ? `${details.width}×${details.height}` : 'resolution unavailable',
    });
}

function recordDownloadSummaryError(report, error, item) {
    const message = error?.message || 'Download failed';
    if (item) {
        const label = getDownloadSummaryLabel(report, item);
        report.failed.push(label);
        report.errors.push(`${label}: ${message}`);
    } else {
        report.errors.push(message);
    }
}

function showDownloadSummary(report) {
    if (!downloadNotificationPreferences.enabled) return;
    const saved = report.saved ? report.items.length : 0;
    const lines = [
        report.total == null ? 'Download could not be completed.' : `${saved} of ${report.total} items downloaded.`,
    ];
    const warnings = [];
    if (report.saved) {
        const groups = new Map();
        for (const item of report.items) {
            const key = `${item.mode} · ${item.resolution}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(item.label);
        }
        for (const [details, labels] of groups) {
            if (!report.requestedProgressive && details.startsWith('Progressive')) warnings.push(lines.length);
            lines.push(`${labels.join(', ')}: ${details}`);
        }
    } else if (report.items.length) {
        lines.push(`${report.items.length} item(s) fetched, but the file or ZIP was not saved.`);
    }
    if (report.failed.length) lines.push(`Failed/skipped: ${report.failed.join(', ')}`);
    const processed = new Set([...report.items.map((item) => item.label), ...report.failed]);
    const remaining = report.requested.filter((entry) => !processed.has(entry.label));
    if (remaining.length) lines.push(`Not processed: ${remaining.map((entry) => entry.label).join(', ')}`);
    if (report.errors.length) lines.push(`Issues: ${report.errors.join('; ')}`);
    showDownloadNotice(lines, warnings);
}

function showDownloadNotice(lines, warnings) {
    let host = document.getElementById('igd-download-notices');
    if (!host) {
        host = document.createElement('div');
        host.id = 'igd-download-notices';
        document.documentElement.append(host);
    }
    const notice = document.createElement('div');
    notice.className = 'igd-download-notice';
    notice.dir = 'ltr';
    notice.lang = 'en';
    const text = document.createElement('div');
    text.className = 'igd-download-notice-text';
    text.setAttribute('role', 'status');
    text.setAttribute('aria-live', 'polite');
    lines.forEach((line, index) => {
        const row = document.createElement('div');
        row.textContent = line;
        if (warnings.includes(index)) row.className = 'igd-download-notice-warning';
        text.append(row);
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Dismiss download summary');
    let timer;
    const dismiss = () => {
        clearTimeout(timer);
        notice.remove();
        if (!host.childElementCount) host.remove();
    };
    close.addEventListener('click', dismiss);
    notice.append(text, close);
    host.append(notice);
    timer = setTimeout(dismiss, downloadNotificationPreferences.durationSeconds * 1000);
}
