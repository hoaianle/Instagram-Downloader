#!/usr/bin/env node

const fs = require('fs');
const { execFileSync } = require('child_process');

main();

function main() {
    const repository = process.env.GITHUB_REPOSITORY;
    const currentTag = process.env.GITHUB_REF_NAME;

    if (!repository || !currentTag) {
        console.error('GITHUB_REPOSITORY and GITHUB_REF_NAME are required.');
        process.exit(1);
    }

    const previousTag = getPreviousTag(currentTag);
    const range = previousTag ? `${previousTag}..${currentTag}` : currentTag;

    const commits = getCommits(range);
    const releaseNotes = [];

    for (const commit of commits) {
        if (!commit.releaseNotes) {
            continue;
        }

        const notes = commit.releaseNotes.trim();

        if (notes === 'N/A' || notes === '- N/A') {
            continue;
        }

        releaseNotes.push({
            pr: commit.pr,
            note: notes.replace(/^- /, ''),
        });
    }

    const compareUrl = previousTag
        ? `https://github.com/${repository}/compare/${previousTag}...${currentTag}`
        : `https://github.com/${repository}/releases/tag/${currentTag}`;

    const output = [];

    output.push(`![icon](https://raw.githubusercontent.com/${repository}/main/icons/icon128.png)`);
    output.push('');
    output.push('# Release Notes');
    output.push('');

    if (releaseNotes.length === 0) {
        output.push('* No public-facing changes.');
    } else {
        for (const item of releaseNotes) {
            if (item.pr) {
                output.push(`* ${item.note} (#${item.pr})`);
            } else {
                output.push(`* ${item.note}`);
            }
        }
    }

    output.push('');
    output.push(`**Full Changelog**: ${compareUrl}`);
    output.push('');

    fs.writeFileSync('release-notes.md', output.join('\n'));

    console.log('Generated release-notes.md');
}

function getPreviousTag(currentTag) {
    const tags = git('tag', ['--sort=-version:refname'])
        .split('\n')
        .filter((tag) => tag.startsWith('v') && tag !== currentTag);

    return tags[0] || null;
}

function getCommits(range) {
    return git('log', [range, '--format=DIVIDER%n%H|||%B']).split('DIVIDER\n').filter(Boolean).map(parseCommit);
}

function parseCommit(commit) {
    const [header] = commit.split('\n');
    const [hash, firstLine] = header.split('|||');

    const pr = firstLine.match(/\(#(\d+)\)$/)?.[1] ?? '';

    const releaseNotes = (commit.split(/Release Notes:\s*\n/i)[1] ?? '')
        .split('\n\n')[0]
        .trim()
        .replace(/\n(?![\n-])/g, ' ');

    return {
        hash,
        pr,
        firstLine,
        releaseNotes,
    };
}

function git(command, args) {
    return execFileSync('git', [command, ...args], {
        encoding: 'utf8',
    }).replace(/\r\n/g, '\n');
}
