# shockpkg core

The core shockpkg library.

[![npm](https://img.shields.io/npm/v/@shockpkg/core.svg)](https://npmjs.com/package/@shockpkg/core)
[![node](https://img.shields.io/node/v/@shockpkg/core.svg)](https://nodejs.org)

[![dependencies](https://david-dm.org/shockpkg/core.svg)](https://david-dm.org/shockpkg/core)
[![size](https://packagephobia.now.sh/badge?p=@shockpkg/core)](https://packagephobia.now.sh/result?p=@shockpkg/core)
[![downloads](https://img.shields.io/npm/dm/@shockpkg/core.svg)](https://npmcharts.com/compare/@shockpkg/core?minimal=true)

[![travis-ci](https://travis-ci.org/shockpkg/core.svg?branch=master)](https://travis-ci.org/shockpkg/core)


# Overview

The core package manager library for shockpkg packages.


# Usage

## Basic Usage

```js
import {Manager} from '@shockpkg/core';

async function main() {
	const manager = new Manager();
	await manager.with(async manager => {
		await manager.update();

		await manager.installSlim('some-package-name-or-hash');
	});
}

main().catch(err => {
	process.exitCode = 1;
	console.error(err);
});
```


# Bugs

If you find a bug or have compatibility issues, please open a ticket under issues section for this repository.


# License

Copyright (c) 2018-2020 JrMasterModelBuilder

Licensed under the Mozilla Public License, v. 2.0.

If this license does not work for you, feel free to contact me.
