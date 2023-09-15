# shockpkg Core

The core shockpkg library.

[![npm](https://img.shields.io/npm/v/@shockpkg/core.svg)](https://npmjs.com/package/@shockpkg/core)
[![node](https://img.shields.io/node/v/@shockpkg/core.svg)](https://nodejs.org)

[![size](https://packagephobia.now.sh/badge?p=@shockpkg/core)](https://packagephobia.now.sh/result?p=@shockpkg/core)
[![downloads](https://img.shields.io/npm/dm/@shockpkg/core.svg)](https://npmcharts.com/compare/@shockpkg/core?minimal=true)

[![Build Status](https://github.com/shockpkg/core/workflows/main/badge.svg?branch=master)](https://github.com/shockpkg/core/actions?query=workflow%3Amain+branch%3Amaster)

# Overview

The core package manager library for shockpkg packages.

# Usage

## Basic Usage

```js
import {Manager} from '@shockpkg/core';

await new Manager().with(async manager => {
	const pkg = 'some-package-name-or-hash';
	await manager.update();
	await manager.install(pkg);
	const file = await manager.packageInstallFile(pkg);
	console.log(file);
});
```

# Bugs

If you find a bug or have compatibility issues, please open a ticket under issues section for this repository.

# License

Copyright (c) 2018-2023 JrMasterModelBuilder

Licensed under the Mozilla Public License, v. 2.0.

If this license does not work for you, feel free to contact me.
