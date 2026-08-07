# CONTRIBUTING

Welcome, and thank you for contributing! To maintain project stability, please follow these guidelines when submitting contributions.

## Prerequisites

- Always format your code by running `make format` before opening a pull request (PR).
- Always follow the provided [PR template](.github/pull_request_template.md).

---

## Welcome Contributions

- **Bug Fixes:** Targeted resolutions for reported issues.
- **Feature Enhancements:** Improvements or updates to existing features.
- **New Features:** Additions that align with the core scope of the project.

---

## Contribution Guidelines

To ensure smooth maintenance and quick PR reviews, please adhere to the following principles:

1. **Avoid Unnecessary Refactoring**
    - Keep PRs scoped to the specific issue or feature. Refactoring working code creates extra testing overhead and increases the risk of regressions.

2. **Do Not Remove Features Without Prior Discussion**
    - If a feature exists, it likely serves a specific edge case. Avoid removing code or functionality unless discussed first in an issue.

3. **Avoid Fragile DOM Selectors**
    - Since this is an Instagram browser extension, Instagram's frequent frontend updates easily break DOM-dependent logic. Avoid relying on dynamic class names or rigid structural paths. Keep selectors resilient to minimize maintenance breakage.
