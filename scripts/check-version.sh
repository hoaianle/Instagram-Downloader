#!/usr/bin/env bash

set -euo pipefail

MANIFEST_VERSION=$(jq -r '.version' manifest.json)

if [ "v$MANIFEST_VERSION" != "$GITHUB_REF_NAME" ]; then
    echo "Version mismatch: manifest=v$MANIFEST_VERSION, tag=$GITHUB_REF_NAME"
    # Delete the remote tag
    git push origin ":refs/tags/$GITHUB_REF_NAME"
    exit 1
fi
