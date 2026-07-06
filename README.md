# Instagram-Downloader

![icon](icons/icon128.png)

## How this work

With regex and some `ReactFiber` magic, I'm able to know which post you wanna download and fetch the api to download the photos for you.

## Browser compatibility

This extension should work fine on the following browsers with `fetch()` API and Chromium base browser, tested Browser:

- Google Chrome
- MS Edge
- FireFox

## Download and install

- Download [latest version](https://github.com/HOAIAN2/Instagram-Downloader/releases) and extract to a folder

### Chrome or other Chromium browsers

- Enable Chrome extensions developer mode
- Drag and drop extracted folder to `chrome://extensions/`

### Firefox (Development)

- Go to Add-ons Manager `about:addons`
- Click on Setting > Debug Add-ons
- Click on `Load Temporary Add-on...` and select the `manifest.json` file

## Usage

- Go to any `post`, `reels`, `stories`, etc. Then click `Download` button to fetch data.

- Click on any photos/videos to save.

- Toggle multi select by click on `Photos` and select photos by click on them (or select all by click and hold on `Photos`). Then click on `Download` to save zip file.

- If you scroll on the home page, this app will auto detect the post you wanna download so you don't have to click to comment section to open modal. Thanks to ReactFiber.

## Features

- Download posts ✔
- Download reels ✔
- Download latest stories ✔
- Download highlight stories ✔
- Support high resolution ✔
- Support download zip file ✔

## Customize

You can modify anything you want except some constants start with "IG\_" that definitely gonna break this extension.

Edit Hide / Show Transition effects

```css
.display-container.hide {
    transform-origin: 85% bottom;
    transform: scale(0);
    pointer-events: none;
    opacity: 0.6;
}
```

## Keyboard shortcut

Some keyboard shortcuts will not work if you use an external application for typing.

- Download: `D`
- Close: `esc` `C` 
- Select all `S`
- Keyboard shortcut should work if you don't focus on special HTML Elements like `input` `textarea` or any element with `textbox` role (ex: comment, search, ...)

## Deprecated features

These features was deprecated for some reason.

- V5.1.0
    - Set fallback download to latest post from some user.

## Notes

If you save extension on external partition or drive and your Linux Distro doesn't mount automatically, extension will disappear. You have to mount that partition/drive and restart browser.

## Here is Demo

[Demo v5.1.0](https://github.com/HOAIAN2/Instagram-Downloader/assets/98139595/917369c9-cdbb-4315-8e6d-7a1632a8888b)
