function showDownloadNotice(message, warningLines = []) {
    if (!downloadNotificationPreferences.enabled) return;
    let host = document.getElementById('igd-download-notices');
    if (!host) {
        host = document.createElement('div');
        host.id = 'igd-download-notices';
        document.documentElement.append(host);
    }
    const notice = document.createElement('div');
    notice.className = 'igd-download-notice';
    notice.dir = 'ltr';
    const text = document.createElement('span');
    text.setAttribute('role', 'status');
    text.setAttribute('aria-live', 'polite');
    message.split('\n').forEach((line, index) => {
        if (index) text.append(document.createTextNode('\n'));
        const row = document.createElement('span');
        row.textContent = line;
        if (warningLines.includes(index)) row.className = 'igd-download-notice-warning';
        text.append(row);
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Dismiss notification');
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

function createDownloadReport(total = 1) {
    return {
        total,
        requestedProgressive: videoDownloadPreferences.usesProgressive(),
        saved: false,
        items: [],
        skipped: 0,
        skippedIds: [],
        fallback: [],
        errors: [],
        stopped: false,
        labels: new Map(),
    };
}

function setDownloadReportMedia(report, data, media) {
    report.total = media.length;
    for (const item of media) {
        const index = data.media.findIndex(
            (candidate) => candidate === item || String(candidate.id) === String(item.id),
        );
        report.labels.set(String(item.id), index >= 0 ? `Item ${index + 1}` : `Media ${item.id}`);
    }
}

function getDownloadReportLabel(report, item) {
    return report.labels.get(String(item.id)) || `Media ${item.id}`;
}

function recordDownloadedItem(report, result) {
    const item = result.item;
    const progressive = result.mode === 'progressive';
    const width = progressive ? item.progressiveWidth : item.width;
    const height = progressive ? item.progressiveHeight : item.height;
    report.items.push({
        id: String(item.id || 'unknown'),
        label: getDownloadReportLabel(report, item),
        quality: width && height ? width + '×' + height : 'resolution unavailable',
        mode: result.mode || (item.isVideo ? 'DASH' : 'image'),
    });
}

function showDownloadReport(report) {
    const count = report.saved ? report.items.length : 0;
    const lines = [count + ' of ' + report.total + ' items downloaded.'];
    const warningLines = [];
    if (count) {
        const groups = new Map();
        for (const item of report.items) {
            const label = item.mode + ' · ' + item.quality;
            if (!groups.has(label)) groups.set(label, []);
            groups.get(label).push(item.label);
        }
        for (const [label, items] of groups) {
            if (!report.requestedProgressive && label.startsWith('progressive ·')) warningLines.push(lines.length);
            lines.push(items.join(', ') + ': ' + label);
        }
        const progressive = report.items.filter((item) => item.mode === 'progressive');
        if (progressive.length) {
            if (!report.requestedProgressive) warningLines.push(lines.length);
            lines.push('Progressive: ' + progressive.map((item) => item.label).join(', '));
        }
    }
    if (report.skippedIds.length) lines.push('Skipped: ' + report.skippedIds.join(', '));
    if (report.fallback.length) lines.push('Fallback quality: ' + [...new Set(report.fallback)].join(', '));
    if (report.errors.length) lines.push('Issues: ' + [...new Set(report.errors)].join('; '));
    if (report.stopped) lines.push('Stopped: Instagram is limiting requests. Try again later.');
    const remaining = report.total - report.items.length - report.skippedIds.length;
    if (remaining > 0) lines.push(remaining + ' item(s) not processed.');
    showDownloadNotice(lines.join('\n'), warningLines);
}
