# Changelog

## [3.0.0] - 2025-04-20

_If you are upgrading: please see [`UPGRADING.md`](UPGRADING.md)._

### Changed

- **Breaking:** upgrade to `abstract-level` 3 ([#112](https://github.com/Level/classic-level/issues/112)) ([`812fe88`](https://github.com/Level/classic-level/commit/812fe88)) (Vincent Weevers)

### Added

- Add `db.getSync()` method ([#120](https://github.com/Level/classic-level/issues/120)) ([`7a2bd2c`](https://github.com/Level/classic-level/commit/7a2bd2c)) (Vincent Weevers)
- Implement `has()` and `hasMany()` ([#111](https://github.com/Level/classic-level/issues/111)) ([`6aeb739`](https://github.com/Level/classic-level/commit/6aeb739)) (Vincent Weevers)
- Implement explicit snapshots ([#110](https://github.com/Level/classic-level/issues/110)) ([`15eb289`](https://github.com/Level/classic-level/commit/15eb289)) (Vincent Weevers)

### Fixed

- Fix TypeScript return type of `get` and `getMany` ([#117](https://github.com/Level/classic-level/issues/117)) ([`e310ffd`](https://github.com/Level/classic-level/commit/e310ffd)) (David Daester)

## [2.0.0] - 2024-10-21

_If you are upgrading: please see [`UPGRADING.md`](UPGRADING.md)._

### Changed

- **Breaking:** bump `abstract-level` to 2.0.0 ([`dff7a67`](https://github.com/Level/classic-level/commit/dff7a67)) (Vincent Weevers)
- **Breaking:** remove callbacks and `LEVEL_NOT_FOUND` ([`d5bad80`](https://github.com/Level/classic-level/commit/d5bad80)) (Vincent Weevers)
- Update README for v2, with a new approach ([`a078b45`](https://github.com/Level/classic-level/commit/a078b45)) (Vincent Weevers)
- Refactor to put more trust in abstract-level state ([`c2426bb`](https://github.com/Level/classic-level/commit/c2426bb)) (Vincent Weevers)
- Use headers of 18.20.4 for prebuilds ([`13bcc68`](https://github.com/Level/classic-level/commit/13bcc68)) (Vincent Weevers)
- Swap CentOS image with AlmaLinux (for linux prebuilds) ([`a3be44d`](https://github.com/Level/classic-level/commit/a3be44d)) (Vincent Weevers)

### Added

- Support `signal` option on iterators ([`6e196dc`](https://github.com/Level/classic-level/commit/6e196dc)) (Vincent Weevers)

### Removed

- **Breaking:** drop Node.js < 18 and Electron < 30 ([`c177f3c`](https://github.com/Level/classic-level/commit/c177f3c), [`e18d5c7`](https://github.com/Level/classic-level/commit/e18d5c7)) (Vincent Weevers)
- Stop testing on FreeBSD ([`ce99a79`](https://github.com/Level/classic-level/commit/ce99a79)) (Vincent Weevers)
- Remove `levelup` compatibility check ([`b086bc8`](https://github.com/Level/classic-level/commit/b086bc8)) (Vincent Weevers)

### Fixed

- Fix cache bug in `iterator.nextv()` ([`1063558`](https://github.com/Level/classic-level/commit/1063558)) (Vincent Weevers)
- Create snapshot for `get()` synchronously ([`50e03dc`](https://github.com/Level/classic-level/commit/50e03dc)) (Vincent Weevers)

## [1.4.1] - 2024-01-20

### Fixed

- Fix race condition in tests ([#90](https://github.com/Level/classic-level/issues/90)) ([`9ff2e82`](https://github.com/Level/classic-level/commit/9ff2e82)) (Matthew Keil).

## [1.4.0] - 2023-11-26

_Not released to npm because of a race issue, which was fixed in 1.4.1._

### Added

- Add opt-in multithreading ([#85](https://github.com/Level/classic-level/issues/85)) ([`7d497a5`](https://github.com/Level/classic-level/commit/7d497a5)) (Matthew Keil).

## [1.3.0] - 2023-04-07

### Changed

- Refactor some pointer usage ([#25](https://github.com/Level/classic-level/issues/25)) ([`d6437b4`](https://github.com/Level/classic-level/commit/d6437b4)) (Robert Nagy)
- Refactor: handle view encoding (Uint8Array) natively ([#43](https://github.com/Level/classic-level/issues/43)) ([`b9fd5e9`](https://github.com/Level/classic-level/commit/b9fd5e9)) (Vincent Weevers)
- Bump and unlock `napi-macros` from 2.0.0 to 2.2.2 ([#58](https://github.com/Level/classic-level/issues/58)) ([`8a4717b`](https://github.com/Level/classic-level/commit/8a4717b)) (Vincent Weevers).

### Fixed

- Swap linux-arm build to use `linux-arm64-lts` ([#71](https://github.com/Level/classic-level/issues/71)) ([`5ea74ab`](https://github.com/Level/classic-level/commit/5ea74ab)) (Cody Swendrowski)
- Add `openssl_fips` variable to gyp bindings ([#72](https://github.com/Level/classic-level/issues/72)) ([`b3f8517`](https://github.com/Level/classic-level/commit/b3f8517)) (Cody Swendrowski).

## [1.2.0] - 2022-03-25

### Added

- Yield `LEVEL_LOCKED` error when lock is held ([#8](https://github.com/Level/classic-level/issues/8)) ([`aa975de`](https://github.com/Level/classic-level/commit/aa975de)) (Vincent Weevers)

### Fixed

- Fix `getMany()` memory leak ([#9](https://github.com/Level/classic-level/issues/9)) ([`00364c7`](https://github.com/Level/classic-level/commit/00364c7)) (Vincent Weevers).

## [1.1.0] - 2022-03-06

### Added

- Create location directory recursively ([#6](https://github.com/Level/classic-level/issues/6)) ([`1ba0b69`](https://github.com/Level/classic-level/commit/1ba0b69)) (Vincent Weevers)

### Fixed

- Fix TypeScript type declarations ([`a79fe82`](https://github.com/Level/classic-level/commit/a79fe82)) (Vincent Weevers)
- Document the return type of `db.batch()` and add example ([`a909ea6`](https://github.com/Level/classic-level/commit/a909ea6)) (Vincent Weevers).

## [1.0.0] - 2022-03-04

_:seedling: Initial release. If you are upgrading from `leveldown` please see [`UPGRADING.md`](UPGRADING.md)._

[3.0.0]: https://github.com/Level/classic-level/releases/tag/v3.0.0

[2.0.0]: https://github.com/Level/classic-level/releases/tag/v2.0.0

[1.4.1]: https://github.com/Level/classic-level/releases/tag/v1.4.1

[1.4.0]: https://github.com/Level/classic-level/releases/tag/v1.4.0

[1.3.0]: https://github.com/Level/classic-level/releases/tag/v1.3.0

[1.2.0]: https://github.com/Level/classic-level/releases/tag/v1.2.0

[1.1.0]: https://github.com/Level/classic-level/releases/tag/v1.1.0

[1.0.0]: https://github.com/Level/classic-level/releases/tag/v1.0.0
