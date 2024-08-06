# shockpkg Core

The core shockpkg library.

[![npm](https://img.shields.io/npm/v/@shockpkg/core.svg)](https://npmjs.com/package/@shockpkg/core)
[![node](https://img.shields.io/node/v/@shockpkg/core.svg)](https://nodejs.org)

[![size](https://packagephobia.now.sh/badge?p=@shockpkg/core)](https://packagephobia.now.sh/result?p=@shockpkg/core)
[![downloads](https://img.shields.io/npm/dm/@shockpkg/core.svg)](https://npmcharts.com/compare/@shockpkg/core?minimal=true)

[![main](https://github.com/shockpkg/core/actions/workflows/main.yaml/badge.svg)](https://github.com/shockpkg/core/actions/workflows/main.yaml)

# Overview

The core package manager library for shockpkg packages.

# Usage

## Basic Usage

```js
import {Manager} from '@shockpkg/core';

const manager = new Manager();
const pkg = 'some-package-name-or-hash';
await manager.update();
await manager.install(pkg);
const file = await manager.file(pkg);
console.log(file);
```

# Bugs

If you find a bug or have compatibility issues, please open a ticket under issues section for this repository.

# License

Copyright (c) 2018-2024 JrMasterModelBuilder

Licensed under the Mozilla Public License, v. 2.0.

If this license does not work for you, feel free to contact me.
