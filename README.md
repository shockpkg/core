# shockpkg core

The core shockpkg library.


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

Copyright (c) 2018-2019 JrMasterModelBuilder

Licensed under the Mozilla Public License, v. 2.0.

If this license does not work for you, feel free to contact me.
