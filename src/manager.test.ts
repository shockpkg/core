/* eslint-disable max-classes-per-file */
/* eslint-disable max-nested-callbacks */

import {describe, it, beforeEach, afterEach} from 'node:test';
import {deepStrictEqual, ok, strictEqual} from 'node:assert';
import {createReadStream} from 'node:fs';
import {lstat, mkdir, rm, writeFile} from 'node:fs/promises';
import {pipeline} from 'node:stream';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';

import express from 'express';

import {Manager} from './manager';
import {Package} from './package';
import {IPackageDownloadProgress, IPackageExtractProgress} from './types';
import {createServer} from './util.spec';

const pipe = promisify(pipeline);

const strReverse = (s: string) => s.split('').reverse().join('');

const tmpPath = './spec/tmp/manager';

const unknownDirEmpty = 'unknown-dir-empty';

const packageObsoleteA = {
	name: 'package-obsolete-a',
	file: 'package-obsolete-a.bin',
	size: 42,
	sha256: '4242424242424242424242424242424242424242424242424242424242424242',
	sha1: '4242424242424242424242424242424242424242',
	md5: '42424242424242424242424242424242',
	source: 'http://example.com/package-obsolete-a.bin'
};
const packageObsoleteB = {
	name: 'package-obsolete-b',
	file: 'package-obsolete-b.bin',
	size: 24,
	sha256: '2424242424242424242424242424242424242424242424242424242424242424',
	sha1: '2424242424242424242424242424242424242424',
	md5: '24242424242424242424242424242424',
	source: 'http://example.com/package-obsolete-b.bin'
};

const packageSingle = {
	name: 'package-single',
	file: 'package-single.bin',
	size: 366161,
	sha256: '781fea60126eb92dbb97d321eea607c3a65708eb16ed297b697563567a2d4cf2',
	sha1: 'af83c8cf116f6c4f4670637ca62d8eb022faf1da',
	md5: 'f10462a5ed89350011cfc120f5bd8a9a',
	source: '/packages/package-single.bin'
};
const packageMultiA = {
	name: 'package-multi-a',
	file: 'package-multi-a.bin',
	size: 270560,
	sha256: 'd84821ba140cc355bf3b5f54b3c02a40467df267e0d9ca88f34c1a11c152bc7b',
	sha1: '1ef6c57d5b9f80421988fe2b2bc293f58cec5964',
	md5: '0933f47c8bf83c91a552d72d773258d6',
	source: 'package-multi/package-multi-a.bin',
	zipped: '8-107-65092'
};
const packageMultiB = {
	name: 'package-multi-b',
	file: 'package-multi-b.bin',
	size: 270560,
	sha256: '5bfc83ad4988e63120c317166c985367ed0d6a155efef25f61b9b4837ab65fd1',
	sha1: '5aa9f5e51f5a8bd965ba53e3a3b056361c93f95f',
	md5: '2e82f05e1b2f313176fd4c0b3aab0e15',
	source: 'package-multi/package-multi-b.bin',
	zipped: '8-65262-64705'
};
const packageMulti = {
	name: 'package-multi',
	file: 'package-multi.zip',
	size: 130315,
	sha256: 'b26ebd9b476943895c53ece1fbedb1a3f71741b96bb41386bf31f64858c882d9',
	sha1: '55713f6be04ebc7984f569b2ecffb8b72a46cb11',
	md5: '0c86607e1f057400ad66693a4bdda23c',
	source: '/packages/package-multi.zip',
	packages: [packageMultiA, packageMultiB]
};
const packageNested = {
	name: 'package-nested',
	file: 'package-nested.bin',
	size: 729267,
	sha256: '93116b4ab456da0d1d721f93673e084b5b80e283f617376bdef600993840c092',
	sha1: 'de136cfe07f84cd5af12b389a19ed9197065d661',
	md5: '63b7339834157c94bcc37e07310d93ce',
	source: 'package-nested-1/package-nested.bin',
	zipped: '8-186-171223'
};
const packageNested1 = {
	name: 'package-nested-1',
	file: 'package-nested-1.zip',
	size: 171949,
	sha256: 'cbf960773625011d6788ed7b0e832b2a945ec995bc3c560e28881ffaffb61861',
	sha1: 'd0dd9c4b1f6940b9637b7fd161672490512d2293',
	md5: 'a6df4185081d004b4edd3a9a93b7971a',
	source: 'package-nested-2/package-nested-1.zip',
	zipped: '0-170-171949',
	packages: [packageNested]
};
const packageNested2 = {
	name: 'package-nested-2',
	file: 'package-nested-2.zip',
	size: 172335,
	sha256: 'c053d326a100f85344080ffdad87ed71a42cfa35580548adf7480639e00acd6a',
	sha1: '3de393e117cdc597ee5c593fa5456d1c4cb7ed49',
	md5: 'e636b48088f9ddba7fc3295c7f401df8',
	source: '/packages/package-nested-2.zip',
	packages: [packageNested1]
};

const packages = {
	format: '1.2',
	packages: [packageSingle, packageMulti, packageNested2]
};

const packageMultiMeta = {
	name: packageMulti.name,
	file: packageMulti.file,
	size: packageMulti.size,
	sha256: packageMulti.sha256,
	sha1: packageMulti.sha1,
	md5: packageMulti.md5,
	source: packageMulti.source
};

const packageSingleMetaBad = {
	name: packageSingle.name,
	file: packageSingle.file,
	size: packageSingle.size + 1,
	sha256: strReverse(packageSingle.sha256),
	sha1: strReverse(packageSingle.sha1),
	md5: strReverse(packageSingle.md5),
	source: `https://example.com${packageSingle.source}`
};

const packageNested1MetaBad = {
	name: packageNested1.name,
	file: packageNested1.file,
	size: packageNested1.size + 1,
	sha256: strReverse(packageNested1.sha256),
	sha1: strReverse(packageNested1.sha1),
	md5: strReverse(packageNested1.md5),
	source: packageNested1.source
};

function packagesCopy() {
	return JSON.parse(JSON.stringify(packages)) as typeof packages;
}

interface IPackageEventLog {
	//
	/**
	 * Which event.
	 */
	which: string;

	/**
	 * Which package.
	 */
	package: string;
}

/**
 * Manager subclass with some extra methods for testing.
 */
class ManagerTest extends Manager {
	/**
	 * Test that code throws during _exclusiveAsync.
	 *
	 * @param func Test function.
	 */
	public async $testExclusiveAsync(func: (self: this) => Promise<unknown>) {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		const err = await this._exclusiveAsync(async () => {
			try {
				await func.call(this, this);
			} catch (err) {
				// eslint-disable-next-line @typescript-eslint/no-unsafe-return
				return err;
			}
			throw new Error('Failed to get error');
		});
		ok(err);
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
		strictEqual(err.message, 'Already running exclusive method');
	}

	/**
	 * Test that code throws during _exclusiveSync.
	 *
	 * @param func Test function.
	 */
	public $testExclusiveSync(func: (self: this) => unknown) {
		// eslint-disable-next-line no-sync, @typescript-eslint/no-unsafe-assignment
		const err = this._exclusiveSync(() => {
			try {
				func.call(this, this);
			} catch (err) {
				// eslint-disable-next-line @typescript-eslint/no-unsafe-return
				return err;
			}
			throw new Error('Failed to get error');
		});
		ok(err);
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
		strictEqual(err.message, 'Already running exclusive method');
	}
}

/**
 * Get the error from a promise.
 *
 * @param p Promise object.
 * @returns The error or undefined.
 */
async function promiseError(p: Promise<unknown>) {
	try {
		await p;
	} catch (err) {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-return
		return err;
	}
	throw new Error('Failed to get error');
}

/**
 * Create an HTTP server on a random port for testing.
 *
 * @param packages Packages list to use.
 * @returns Server details.
 */
async function createServerManager(packages: string) {
	const server = await createServer();
	server.app.get('/packages.json', (req, res) => {
		// eslint-disable-next-line no-use-before-define
		const reqHost = req.headers.host || server.host;
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		const data = JSON.parse(packages);
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
		for (const pkg of data.packages || []) {
			// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/restrict-template-expressions
			pkg.source = `${server.protocol}//${reqHost}${pkg.source}`;
		}
		res.send(JSON.stringify(data, null, '\t'));
	});
	server.app.use('/packages', express.static('spec/fixtures/packages'));
	return server;
}

/**
 * SHA256 hash a buffer.
 *
 * @param buffer The buffer.
 * @returns SHA256 hash.
 */
function sha256Buffer(buffer: Buffer) {
	return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Ensure driectories in a manager instance.
 *
 * @param manager Manager instance.
 * @param dirs Directory paths.
 */
async function managerEnsureDirs(manager: ManagerTest, dirs: string[][]) {
	await Promise.all(
		dirs.map(async a => mkdir(manager.pathTo(...a), {recursive: true}))
	);
}

/**
 * Ensure directories in a manager instance.
 *
 * @param manager Manager instance.
 * @param pkg Package name.
 * @param info Info data.
 */
async function managerWritePackageMeta(
	manager: ManagerTest,
	pkg: string,
	info: unknown
) {
	const f = manager.pathTo(pkg, manager.metaDir, manager.packageFile);
	await mkdir(manager.pathTo(pkg, manager.metaDir), {recursive: true});
	await writeFile(f, JSON.stringify(info, null, '\t'));
}

/**
 * Check if file exists in a manager instance.
 *
 * @param manager Manager instance.
 * @param path File path.
 * @returns True if file, false if anything else or not exist.
 */
async function managerFileExists(manager: ManagerTest, path: string[]) {
	const file = manager.pathTo(...path);
	try {
		const stat = await lstat(file);
		return stat.isFile();
	} catch (err) {
		return false;
	}
}

/**
 * Check if directory exists in a manager instance.
 *
 * @param manager Manager instance.
 * @param path File path.
 * @returns True if diectory, false if anything else or not exist.
 */
async function managerDirExists(manager: ManagerTest, path: string[]) {
	const dir = manager.pathTo(...path);
	try {
		const stat = await lstat(dir);
		return stat.isDirectory();
	} catch (err) {
		return false;
	}
}

/**
 * SHA256 hash a file in a manager instance.
 *
 * @param manager Manager instance.
 * @param path File path.
 * @returns SHA256 hash, hex encoded, lower case.
 */
async function managerFileSha256(manager: ManagerTest, path: string[]) {
	const file = manager.pathTo(...path);
	const stream = createReadStream(file);
	let hashsum = '';
	const hash = createHash('sha256');
	hash.setEncoding('hex');
	hash.on('finish', () => {
		hashsum = hash.read() as string;
	});
	await pipe(stream, hash);
	return hashsum;
}

/**
 * Run a test with manager constructor, and specified packages list.
 *
 * @param packages Packages data or null.
 * @param func Test function.
 * @returns Spec handler.
 */
function managerTest(
	packages: string | null,
	func: (Manager: typeof ManagerTest) => Promise<void>
) {
	return async () => {
		const localServer =
			typeof packages === 'string'
				? await createServerManager(packages)
				: null;

		const serverUrl = localServer ? localServer.url : 'http://0.0.0.0';
		const packagesUrl = `${serverUrl}/packages.json`;

		/**
		 * Manager subclass for testing against local test server.
		 */
		class ManagerTestLocal extends ManagerTest {
			/**
			 * Overridden package URL for local server.
			 */
			protected _packagesUrl = packagesUrl;
		}

		try {
			await func(ManagerTestLocal);
		} finally {
			if (localServer) {
				await localServer.close();
			}
		}
	};
}

/**
 * Run a test with manager instance, and specified packages list.
 *
 * @param packages Packages data or null.
 * @param func Test function.
 * @returns Spec handler.
 */
function managerTestOne(
	packages: string | null,
	func: (manager: ManagerTest) => Promise<unknown>
) {
	return managerTest(packages, async ManagerTest => {
		await func(new ManagerTest(tmpPath));
	});
}

/**
 * Run a test with manager instance under with, and specified packages list.
 *
 * @param packages Packages data or null.
 * @param func Test function.
 * @returns Spec handler.
 */
function managerTestOneWith(
	packages: string | null,
	func: (manager: ManagerTest) => Promise<unknown>
) {
	return managerTestOne(packages, async manager => {
		await manager.with(async manager => {
			await func(manager);
		});
	});
}

/**
 * Run not active test, async.
 *
 * @param func Test function.
 * @returns Spec handler.
 */
function managerTestNotActiveAsync(
	func: (manager: ManagerTest) => Promise<unknown>
) {
	return managerTestOne(null, async manager => {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		const err = await promiseError(func(manager));
		ok(err);
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
		strictEqual(err.message, 'Instance uninitialized');
	});
}

/**
 * Run not active test, sync.
 *
 * @param func Test function.
 * @returns Spec handler.
 */
function managerTestNotActiveSync(func: (manager: ManagerTest) => unknown) {
	// eslint-disable-next-line @typescript-eslint/require-await
	return managerTestOne(null, async manager => {
		let err: Error | null = null;
		try {
			func(manager);
		} catch (ex) {
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
			err = ex;
		}
		ok(err);
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
		strictEqual(err.message, 'Instance uninitialized');
	});
}

/**
 * Run not loaded test, async.
 *
 * @param func Test function.
 * @returns Spec handler.
 */
function managerTestNotLoadedAsync(
	func: (manager: ManagerTest) => Promise<unknown>
) {
	return managerTestOneWith(null, async manager => {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		const err = await promiseError(func(manager));
		ok(err);
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
		strictEqual(err.message, 'Packages list not loaded');
	});
}

/**
 * Run not loaded test, sync.
 *
 * @param func Test function.
 * @returns Spec handler.
 */
function managerTestNotLoadedSync(func: (manager: ManagerTest) => unknown) {
	// eslint-disable-next-line @typescript-eslint/require-await
	return managerTestOneWith(null, async manager => {
		let err: Error | null = null;
		try {
			func(manager);
		} catch (ex) {
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
			err = ex;
		}
		ok(err);
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
		strictEqual(err.message, 'Packages list not loaded');
	});
}

/**
 * Run exclusive async test.
 *
 * @param func Test function.
 * @returns Spec handler.
 */
function managerTestExclusiveAsync(
	func: (manager: ManagerTest) => Promise<unknown>
) {
	return managerTestOneWith(null, async manager => {
		await manager.$testExclusiveAsync(func);
	});
}

/**
 * Run exclusive sync test.
 *
 * @param func Test function.
 * @returns Spec handler.
 */
function managerTestExclusiveSync(func: (manager: ManagerTest) => unknown) {
	// eslint-disable-next-line @typescript-eslint/require-await
	return managerTestOneWith(null, async manager => {
		// eslint-disable-next-line no-sync
		manager.$testExclusiveSync(func);
	});
}

/**
 * Tests for methods, async.
 *
 * @param func Function to test method.
 * @param loaded Require loaded.
 */
function testMethodAsync(
	func: (manager: ManagerTest) => Promise<unknown>,
	loaded = true
) {
	void it('exclusive', managerTestExclusiveAsync(func));

	void it('not active', managerTestNotActiveAsync(func));

	if (loaded) {
		void it('not loaded', managerTestNotLoadedAsync(func));
	}
}

/**
 * Tests for methods, sync.
 *
 * @param func Function to test method.
 * @param loaded Require loaded.
 */
function testMethodSync(
	func: (manager: ManagerTest) => unknown,
	loaded = true
) {
	// eslint-disable-next-line no-sync
	void it('exclusive', managerTestExclusiveSync(func));

	// eslint-disable-next-line no-sync
	void it('not active', managerTestNotActiveSync(func));

	if (loaded) {
		// eslint-disable-next-line no-sync
		void it('not loaded', managerTestNotLoadedSync(func));
	}
}

/**
 * Events logger.
 *
 * @param manager Manager instance.
 * @param events Events ordered.
 * @returns Reset function to reset the lists.
 */
function eventsLogger(manager: ManagerTest, events: IPackageEventLog[] = []) {
	let prevDownloadProgress: IPackageDownloadProgress | null = null;
	let prevExtractProgress: IPackageExtractProgress | null = null;

	const add = (o: IPackageEventLog) => {
		events.push(o);
	};

	manager.eventPackageCleanupBefore.on(event => {
		add({
			which: 'cleanup-before',
			package: event.package
		});
	});
	manager.eventPackageCleanupAfter.on(event => {
		add({
			which: 'cleanup-after',
			package: event.package
		});
	});

	manager.eventPackageInstallBefore.on(event => {
		add({
			which: 'install-before',
			package: event.package.name
		});
	});
	manager.eventPackageInstallAfter.on(event => {
		add({
			which: 'install-after',
			package: event.package.name
		});
	});
	manager.eventPackageInstallCurrent.on(event => {
		add({
			which: 'install-current',
			package: event.package.name
		});
	});

	manager.eventPackageDownloadBefore.on(event => {
		add({
			which: 'download-before',
			package: event.package.name
		});
	});
	manager.eventPackageDownloadProgress.on(event => {
		const start = event.amount === 0;
		const end = event.amount === event.total;

		if (event.amount > event.total) {
			throw new Error('Download progress: Over amount');
		}
		if (prevDownloadProgress && !start) {
			if (event.total !== prevDownloadProgress.total) {
				throw new Error('Download progress: Total changed');
			}
			if (event.amount <= prevDownloadProgress.amount) {
				throw new Error('Download progress: No progress');
			}
		}

		// Only add first and last progress.
		if (start || end) {
			add({
				which: 'download-progress',
				package: event.package.name
			});
		}
		prevDownloadProgress = event;
	});
	manager.eventPackageDownloadAfter.on(event => {
		add({
			which: 'download-after',
			package: event.package.name
		});
	});

	manager.eventPackageExtractBefore.on(event => {
		add({
			which: 'extract-before',
			package: event.package.name
		});
	});
	manager.eventPackageExtractProgress.on(event => {
		const start = event.amount === 0;
		const end = event.amount === event.total;

		if (event.amount > event.total) {
			throw new Error('Extract progress: Over amount');
		}
		if (prevExtractProgress && !start) {
			if (event.total !== prevExtractProgress.total) {
				throw new Error('Extract progress: Total changed');
			}
			if (event.amount <= prevExtractProgress.amount) {
				throw new Error('Extract progress: No progress');
			}
		}

		// Only add first and last progress.
		if (start || end) {
			add({
				which: 'extract-progress',
				package: event.package.name
			});
		}
		prevExtractProgress = event;
	});
	manager.eventPackageExtractAfter.on(event => {
		add({
			which: 'extract-after',
			package: event.package.name
		});
	});

	return () => {
		prevDownloadProgress = null;
		prevExtractProgress = null;
		events.splice(0, events.length);
	};
}

void describe('manager', () => {
	void describe('Manager', () => {
		void beforeEach(async () => {
			await rm(tmpPath, {recursive: true, force: true});
		});

		void afterEach(async () => {
			await rm(tmpPath, {recursive: true, force: true});
		});

		void describe('init + destroy', () => {
			void it(
				'simple',
				managerTestOne(null, async manager => {
					await manager.init();
					await manager.destroy();
				})
			);

			void it(
				'init once',
				managerTestOne(null, async manager => {
					await manager.init();
					// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
					const err = await promiseError(manager.init());
					ok(err);
					// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
					strictEqual(err.message, 'Instance initialized');
					await manager.destroy();
				})
			);

			void it(
				'destroy once',
				managerTestOne(null, async manager => {
					await manager.init();
					await manager.destroy();
					// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
					const err = await promiseError(manager.destroy());
					ok(err);
					// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
					strictEqual(err.message, 'Instance uninitialized');
				})
			);

			void it(
				'init exclusive',
				managerTestOne(JSON.stringify(packages), async manager => {
					await manager.$testExclusiveAsync(async () => {
						await manager.init();
					});
				})
			);

			void it(
				'destroy exclusive',
				managerTestOne(JSON.stringify(packages), async manager => {
					await manager.init();
					await manager.$testExclusiveAsync(async () => {
						await manager.destroy();
					});
					await manager.destroy();
				})
			);

			void it(
				'init destroy 2x',
				managerTest(null, async ManagerTest => {
					const manager1 = new ManagerTest(tmpPath);
					await manager1.init();
					await manager1.destroy();

					const manager2 = new ManagerTest(tmpPath);
					await manager2.init();
					await manager2.destroy();
				})
			);

			void it(
				'init locked',
				managerTest(null, async ManagerTest => {
					const manager1 = new ManagerTest(tmpPath);
					const manager2 = new ManagerTest(tmpPath);

					await manager1.init();
					// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
					const err = await promiseError(manager2.init());
					ok(err);
					// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
					strictEqual(err.message, 'Lock file is already being held');
				})
			);

			void it(
				'init destroy 2x reuse',
				managerTest(null, async ManagerTest => {
					const manager = new ManagerTest(tmpPath);
					await manager.init();
					await manager.destroy();
					await manager.init();
					// await manager.destroy();
				})
			);
		});

		void describe('with', () => {
			void it(
				'active',
				managerTestOne(null, async manager => {
					strictEqual(manager.active, false);
					await manager.with(manager => {
						strictEqual(manager.active, true);
					});
					strictEqual(manager.active, false);
				})
			);

			void it(
				'reuse',
				managerTestOne(null, async manager => {
					strictEqual(manager.active, false);
					await manager.with(manager => {
						strictEqual(manager.active, true);
					});
					await manager.with(manager => {
						strictEqual(manager.active, true);
					});
					strictEqual(manager.active, false);
				})
			);

			void it(
				'throws',
				managerTestOne(null, async manager => {
					strictEqual(manager.active, false);
					const thrown = new Error('With throws');
					// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
					const err = await promiseError(
						manager.with(manager => {
							strictEqual(manager.active, true);
							throw thrown;
						})
					);
					strictEqual(err, thrown);
					strictEqual(manager.active, false);
				})
			);

			void it(
				'directory',
				managerTestOne(null, async manager => {
					await manager.with(async manager => {
						strictEqual(manager.active, true);

						const statTmpPath = await lstat(tmpPath);
						strictEqual(statTmpPath.isDirectory(), true);

						const statMetaDir = await lstat(manager.pathMeta);
						strictEqual(statMetaDir.isDirectory(), true);
					});

					const statTmpPath = await lstat(tmpPath);
					strictEqual(statTmpPath.isDirectory(), true);

					const statMetaDir = await lstat(manager.pathMeta);
					strictEqual(statMetaDir.isDirectory(), true);
				})
			);
		});

		void describe('update', () => {
			testMethodAsync(async manager => manager.update(), false);

			void it(
				'loaded',
				managerTestOne(JSON.stringify(packages), async manager => {
					await manager.init();
					strictEqual(manager.loaded, false);
					await manager.update();
					strictEqual(manager.loaded, true);
				})
			);

			void it(
				'load from disk',
				managerTest(JSON.stringify(packages), async ManagerTest => {
					const manager1 = new ManagerTest(tmpPath);
					await manager1.with(async manager => {
						strictEqual(manager.loaded, false);
						await manager.update();
						strictEqual(manager.loaded, true);
					});

					const manager2 = new ManagerTest(tmpPath);
					await manager2.with(manager => {
						strictEqual(manager.loaded, true);
					});
				})
			);

			void describe('return', () => {
				const writePackage = async (manager: Manager, obj: unknown) => {
					const jsonFile = manager.pathToMeta(manager.packagesFile);
					await mkdir(manager.pathToMeta(), {recursive: true});
					await writeFile(jsonFile, JSON.stringify(obj, null, '\t'));
				};

				void it(
					'added',
					managerTestOne(JSON.stringify(packages), async manager => {
						const mod = packagesCopy();
						mod.packages = mod.packages
							// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
							.filter(
								(p: {name: string}) =>
									p.name !== packageMulti.name
							);

						await writePackage(manager, mod);

						const report = await manager.with(async manager =>
							manager.update()
						);

						deepStrictEqual(report.updated, []);
						deepStrictEqual(
							report.added.map(p => p.name),
							[
								'package-multi',
								'package-multi-a',
								'package-multi-b'
							]
						);
						deepStrictEqual(report.removed, []);
					})
				);

				void it(
					'removed',
					managerTestOne(JSON.stringify(packages), async manager => {
						const mod = packagesCopy();
						mod.packages.push(packageObsoleteA, packageObsoleteB);

						await writePackage(manager, mod);

						const report = await manager.with(async manager =>
							manager.update()
						);

						deepStrictEqual(report.updated, []);
						deepStrictEqual(report.added, []);
						deepStrictEqual(
							report.removed.map(p => p.name),
							[packageObsoleteA.name, packageObsoleteB.name]
						);
					})
				);

				void it(
					'updated: file',
					managerTestOne(JSON.stringify(packages), async manager => {
						const mod = packagesCopy();
						const [pkg] = mod.packages;
						pkg.file += '.old';
						await writePackage(manager, mod);

						const report = await manager.with(async manager =>
							manager.update()
						);

						deepStrictEqual(
							report.updated.map(p => p.name),
							[pkg.name]
						);
						deepStrictEqual(report.added, []);
						deepStrictEqual(report.removed, []);
					})
				);

				void it(
					'updated: size',
					managerTestOne(JSON.stringify(packages), async manager => {
						const mod = packagesCopy();
						const [pkg] = mod.packages;
						pkg.size++;
						await writePackage(manager, mod);

						const report = await manager.with(async manager =>
							manager.update()
						);

						deepStrictEqual(
							report.updated.map(p => p.name),
							[pkg.name]
						);
						deepStrictEqual(report.added, []);
						deepStrictEqual(report.removed, []);
					})
				);

				void it(
					'updated: sha256',
					managerTestOne(JSON.stringify(packages), async manager => {
						const mod = packagesCopy();
						const [pkg] = mod.packages;
						pkg.sha256 = strReverse(pkg.sha256);
						await writePackage(manager, mod);

						const report = await manager.with(async manager =>
							manager.update()
						);

						deepStrictEqual(
							report.updated.map(p => p.name),
							[pkg.name]
						);
						deepStrictEqual(report.added, []);
						deepStrictEqual(report.removed, []);
					})
				);

				void it(
					'ignored: source',
					managerTestOne(JSON.stringify(packages), async manager => {
						const mod = packagesCopy();
						const [pkg] = mod.packages;
						pkg.source += '.old';
						await writePackage(manager, mod);

						const report = await manager.with(async manager =>
							manager.update()
						);

						deepStrictEqual(report.updated, []);
						deepStrictEqual(report.added, []);
						deepStrictEqual(report.removed, []);
					})
				);

				void it(
					'old format',
					managerTestOne(JSON.stringify(packages), async manager => {
						const mod = packagesCopy();
						mod.format = '1.0';
						await writePackage(manager, mod);
						let errorMessage = '';
						manager.eventPackageListError.on(err => {
							errorMessage = err.message;
						});

						const loaded = await manager.with(
							manager => manager.loaded
						);

						ok(!loaded);
						strictEqual(
							errorMessage,
							'Invalid format version minor: 1.0'
						);
					})
				);
			});
		});

		void describe('packageItter', () => {
			void it(
				'return',
				managerTestOneWith(JSON.stringify(packages), async manager => {
					await manager.update();

					const expected = [
						packageSingle,
						packageMulti,
						packageMultiA,
						packageMultiB,
						packageNested2,
						packageNested1,
						packageNested
					].map(p => p.name);

					const listed = [...manager.packageItter()].map(p => p.name);

					deepStrictEqual(listed, expected);
				})
			);
		});

		void describe('packageByName', () => {
			// eslint-disable-next-line no-sync
			testMethodSync(manager =>
				manager.packageByName(packageSingle.name)
			);

			void it(
				'return',
				managerTestOneWith(JSON.stringify(packages), async manager => {
					await manager.update();

					strictEqual(
						manager.packageByName(packageObsoleteA.name),
						null
					);

					ok(manager.packageByName(packageSingle.name));
				})
			);
		});

		void describe('packageBySha256', () => {
			// eslint-disable-next-line no-sync
			testMethodSync(manager =>
				manager.packageBySha256(packageSingle.sha256)
			);

			void it(
				'return',
				managerTestOneWith(JSON.stringify(packages), async manager => {
					await manager.update();

					strictEqual(
						manager.packageBySha256(packageSingleMetaBad.sha256),
						null
					);

					ok(manager.packageBySha256(packageSingle.sha256));
				})
			);
		});

		void describe('packageBySha1', () => {
			// eslint-disable-next-line no-sync
			testMethodSync(manager =>
				manager.packageBySha1(packageSingle.sha1)
			);

			void it(
				'return',
				managerTestOneWith(JSON.stringify(packages), async manager => {
					await manager.update();

					strictEqual(
						manager.packageBySha1(packageSingleMetaBad.sha1),
						null
					);

					ok(manager.packageBySha1(packageSingle.sha1));
				})
			);
		});

		void describe('packageByMd5', () => {
			// eslint-disable-next-line no-sync
			testMethodSync(manager => manager.packageByMd5(packageSingle.md5));

			void it(
				'return',
				managerTestOneWith(JSON.stringify(packages), async manager => {
					await manager.update();

					strictEqual(
						manager.packageByMd5(packageSingleMetaBad.md5),
						null
					);

					ok(manager.packageByMd5(packageSingle.md5));
				})
			);
		});

		void describe('packageByUnique', () => {
			// eslint-disable-next-line no-sync
			testMethodSync(manager =>
				manager.packageByUnique(packageSingle.name)
			);

			void it(
				'return',
				managerTestOneWith(JSON.stringify(packages), async manager => {
					await manager.update();

					strictEqual(
						manager.packageByUnique(packageObsoleteA.name),
						null
					);
					strictEqual(
						manager.packageByUnique(packageSingleMetaBad.sha256),
						null
					);
					strictEqual(
						manager.packageByUnique(packageSingleMetaBad.sha1),
						null
					);
					strictEqual(
						manager.packageByUnique(packageSingleMetaBad.md5),
						null
					);

					ok(manager.packageByUnique(packageSingle.name));
					ok(manager.packageByUnique(packageSingle.sha256));
					ok(manager.packageByUnique(packageSingle.sha1));
					ok(manager.packageByUnique(packageSingle.md5));
				})
			);
		});

		void describe('packageIsMember', () => {
			const packageSingleFake = new Package(packageSingle);

			// eslint-disable-next-line no-sync
			testMethodSync(manager =>
				manager.packageIsMember(packageSingleFake)
			);

			void it(
				'return',
				managerTestOneWith(JSON.stringify(packages), async manager => {
					await manager.update();

					strictEqual(
						manager.packageIsMember(packageSingleFake),
						false
					);

					const packageSingleReal = manager.packageByName(
						packageSingle.name
					);
					ok(packageSingleReal);
					if (packageSingleReal) {
						strictEqual(
							manager.packageIsMember(packageSingleReal),
							true
						);
					}
				})
			);
		});

		void describe('isObsolete', () => {
			testMethodAsync(async manager =>
				manager.isObsolete(packageSingle.name)
			);

			void it(
				'return',
				managerTestOneWith(JSON.stringify(packages), async manager => {
					await manager.update();

					await managerEnsureDirs(manager, [
						[unknownDirEmpty],
						[packageSingle.name, manager.metaDir],
						[packageObsoleteA.name, manager.metaDir],
						[packageObsoleteB.name, manager.metaDir]
					]);

					strictEqual(
						await manager.isObsolete(unknownDirEmpty),
						false
					);
					strictEqual(
						await manager.isObsolete(packageSingle.name),
						false
					);
					strictEqual(
						await manager.isObsolete(packageObsoleteA.name),
						true
					);
					strictEqual(
						await manager.isObsolete(packageObsoleteB.name),
						true
					);
				})
			);
		});

		void describe('isInstalled', () => {
			testMethodAsync(async manager =>
				manager.isInstalled(packageSingle.name)
			);

			void it(
				'return',
				managerTestOneWith(JSON.stringify(packages), async manager => {
					await manager.update();

					await managerWritePackageMeta(
						manager,
						packageSingleMetaBad.name,
						packageSingleMetaBad
					);
					await managerWritePackageMeta(
						manager,
						packageMulti.name,
						packageMultiMeta
					);

					strictEqual(
						await manager.isInstalled(packageSingle.name),
						true
					);
					strictEqual(
						await manager.isInstalled(packageMulti.name),
						true
					);
				})
			);
		});

		void describe('isCurrent', () => {
			testMethodAsync(async manager =>
				manager.isCurrent(packageSingle.name)
			);

			void it(
				'return',
				managerTestOneWith(JSON.stringify(packages), async manager => {
					await manager.update();

					await managerWritePackageMeta(
						manager,
						packageSingleMetaBad.name,
						packageSingleMetaBad
					);
					await managerWritePackageMeta(
						manager,
						packageMulti.name,
						packageMultiMeta
					);

					strictEqual(
						await manager.isCurrent(packageSingle.name),
						false
					);
					strictEqual(
						await manager.isCurrent(packageMulti.name),
						true
					);
				})
			);
		});

		void describe('obsolete', () => {
			testMethodAsync(async manager => manager.obsolete());

			void it(
				'return',
				managerTestOneWith(JSON.stringify(packages), async manager => {
					await manager.update();

					await managerEnsureDirs(manager, [
						[unknownDirEmpty],
						[packageSingle.name, manager.metaDir],
						[packageObsoleteA.name, manager.metaDir],
						[packageObsoleteB.name, manager.metaDir]
					]);

					const obsolete = await manager.obsolete();

					const obsoleteSorted = [...obsolete].sort();
					deepStrictEqual(obsoleteSorted, [
						packageObsoleteA.name,
						packageObsoleteB.name
					]);
				})
			);
		});

		void describe('cleanup', () => {
			testMethodAsync(async manager => manager.cleanup());

			void it(
				'files',
				managerTestOneWith(JSON.stringify(packages), async manager => {
					await manager.update();

					await managerEnsureDirs(manager, [
						[unknownDirEmpty],
						[packageObsoleteA.name, manager.metaDir],
						[packageObsoleteB.name, manager.metaDir]
					]);
					await managerWritePackageMeta(
						manager,
						packageSingleMetaBad.name,
						packageSingleMetaBad
					);

					await manager.cleanup();

					strictEqual(
						await managerDirExists(manager, [unknownDirEmpty]),
						true
					);
					strictEqual(
						await managerDirExists(manager, [packageSingle.name]),
						true
					);
					strictEqual(
						await managerDirExists(manager, [
							packageObsoleteA.name
						]),
						false
					);
					strictEqual(
						await managerDirExists(manager, [
							packageObsoleteB.name
						]),
						false
					);
				})
			);

			void it(
				'return',
				managerTestOneWith(JSON.stringify(packages), async manager => {
					await manager.update();

					await managerEnsureDirs(manager, [
						[unknownDirEmpty],
						[packageObsoleteA.name, manager.metaDir],
						[packageObsoleteB.name, manager.metaDir]
					]);
					await managerWritePackageMeta(
						manager,
						packageSingleMetaBad.name,
						packageSingleMetaBad
					);

					const a = await manager.cleanup();
					const b = await manager.cleanup();

					deepStrictEqual(a, [
						{
							package: packageObsoleteA.name,
							removed: true
						},
						{
							package: packageObsoleteB.name,
							removed: true
						}
					]);
					deepStrictEqual(b, []);
				})
			);

			void it(
				'events',
				managerTestOneWith(JSON.stringify(packages), async manager => {
					await manager.update();

					await managerEnsureDirs(manager, [
						[unknownDirEmpty],
						[packageObsoleteA.name, manager.metaDir],
						[packageObsoleteB.name, manager.metaDir]
					]);
					await managerWritePackageMeta(
						manager,
						packageSingleMetaBad.name,
						packageSingleMetaBad
					);

					const events: IPackageEventLog[] = [];
					const reset = eventsLogger(manager, events);

					await manager.cleanup();
					deepStrictEqual(events, [
						{
							which: 'cleanup-before',
							package: packageObsoleteA.name
						},
						{
							which: 'cleanup-after',
							package: packageObsoleteA.name
						},
						{
							which: 'cleanup-before',
							package: packageObsoleteB.name
						},
						{
							which: 'cleanup-after',
							package: packageObsoleteB.name
						}
					]);

					reset();
					await manager.cleanup();
					deepStrictEqual(events, []);
				})
			);
		});

		void describe('remove', () => {
			testMethodAsync(async manager =>
				manager.remove(packageSingle.name)
			);

			void it(
				'files',
				managerTestOneWith(JSON.stringify(packages), async manager => {
					await manager.update();

					await managerEnsureDirs(manager, [
						[unknownDirEmpty],
						[packageSingle.name, manager.metaDir],
						[packageObsoleteA.name, manager.metaDir],
						[packageObsoleteB.name, manager.metaDir]
					]);

					await manager.remove(unknownDirEmpty);
					await manager.remove(packageSingle.name);
					await manager.remove(packageObsoleteA.name);
					await manager.remove(packageObsoleteB.name);

					strictEqual(
						await managerDirExists(manager, [unknownDirEmpty]),
						false
					);
					strictEqual(
						await managerDirExists(manager, [packageSingle.name]),
						false
					);
					strictEqual(
						await managerDirExists(manager, [
							packageObsoleteA.name
						]),
						false
					);
					strictEqual(
						await managerDirExists(manager, [
							packageObsoleteB.name
						]),
						false
					);
				})
			);

			void it(
				'return',
				managerTestOneWith(JSON.stringify(packages), async manager => {
					await manager.update();

					await managerEnsureDirs(manager, [
						[unknownDirEmpty],
						[packageSingle.name, manager.metaDir],
						[packageObsoleteA.name, manager.metaDir]
					]);

					const a1 = await manager.remove(unknownDirEmpty);
					const a2 = await manager.remove(unknownDirEmpty);
					const b1 = await manager.remove(packageSingle.name);
					const b2 = await manager.remove(packageSingle.name);
					const c1 = await manager.remove(packageObsoleteA.name);
					const c2 = await manager.remove(packageObsoleteA.name);

					strictEqual(a1, true);
					strictEqual(a2, false);
					strictEqual(b1, true);
					strictEqual(b2, false);
					strictEqual(c1, true);
					strictEqual(c2, false);
				})
			);
		});

		void describe('packagesDependOrdered', () => {
			// eslint-disable-next-line no-sync
			testMethodSync(manager => manager.packagesDependOrdered([]));

			void describe('return', () => {
				void it(
					'full',
					managerTestOneWith(
						JSON.stringify(packages),
						async manager => {
							await manager.update();

							const list = [
								packageNested2.name,
								packageNested1.name,
								packageNested.name
							];
							const listRev = list.slice(0).reverse();

							const ordered =
								manager.packagesDependOrdered(listRev);

							const orderedStrs = ordered.map(p => p.name);
							deepStrictEqual(orderedStrs, list);
						}
					)
				);

				void it(
					'skip',
					managerTestOneWith(
						JSON.stringify(packages),
						async manager => {
							await manager.update();

							const list = [
								packageNested2.name,
								packageNested.name
							];
							const listRev = list.slice(0).reverse();

							const ordered =
								manager.packagesDependOrdered(listRev);

							const orderedStrs = ordered.map(p => p.name);
							deepStrictEqual(orderedStrs, list);
						}
					)
				);
			});
		});

		void describe('install', () => {
			testMethodAsync(async manager =>
				manager.install(packageSingle.name)
			);

			void describe('nested level: 0', () => {
				void it(
					'files',
					managerTestOneWith(
						JSON.stringify(packages),
						async manager => {
							await manager.update();

							await manager.install(packageSingle.name);

							strictEqual(
								await managerFileSha256(manager, [
									packageSingle.name,
									packageSingle.file
								]),
								packageSingle.sha256
							);
							strictEqual(
								await managerFileExists(manager, [
									packageSingle.name,
									manager.metaDir,
									manager.packageFile
								]),
								true
							);
						}
					)
				);

				void it(
					'return',
					managerTestOneWith(
						JSON.stringify(packages),
						async manager => {
							await manager.update();

							const a = await manager.install(packageSingle.name);
							const b = await manager.install(packageSingle.name);

							const aValues = a.map(p => p.name);
							deepStrictEqual(aValues, [packageSingle.name]);
							deepStrictEqual(b, []);
						}
					)
				);

				void it(
					'events',
					managerTestOneWith(
						JSON.stringify(packages),
						async manager => {
							await manager.update();

							const events: IPackageEventLog[] = [];
							const reset = eventsLogger(manager, events);

							await manager.install(packageSingle.name);
							deepStrictEqual(events, [
								{
									which: 'install-before',
									package: 'package-single'
								},
								{
									which: 'download-before',
									package: 'package-single'
								},
								{
									which: 'download-progress',
									package: 'package-single'
								},
								{
									which: 'download-progress',
									package: 'package-single'
								},
								{
									which: 'download-after',
									package: 'package-single'
								},
								{
									which: 'install-after',
									package: 'package-single'
								}
							]);

							reset();
							await manager.install(packageSingle.name);
							deepStrictEqual(events, [
								{
									which: 'install-current',
									package: 'package-single'
								}
							]);
						}
					)
				);
			});

			void describe('nested level: 1', () => {
				void it(
					'files',
					managerTestOneWith(
						JSON.stringify(packages),
						async manager => {
							await manager.update();

							await manager.install(packageNested1.name);

							strictEqual(
								await managerFileSha256(manager, [
									packageNested1.name,
									packageNested1.file
								]),
								packageNested1.sha256
							);
							strictEqual(
								await managerFileExists(manager, [
									packageNested1.name,
									manager.metaDir,
									manager.packageFile
								]),
								true
							);

							strictEqual(
								await managerDirExists(manager, [
									packageNested2.name
								]),
								false
							);
						}
					)
				);

				void it(
					'return',
					managerTestOneWith(
						JSON.stringify(packages),
						async manager => {
							await manager.update();

							const a = await manager.install(
								packageNested1.name
							);
							const b = await manager.install(
								packageNested1.name
							);

							const aValues = a.map(p => p.name);
							deepStrictEqual(aValues, [
								packageNested2.name,
								packageNested1.name
							]);
							deepStrictEqual(b, []);
						}
					)
				);

				void it(
					'events',
					managerTestOneWith(
						JSON.stringify(packages),
						async manager => {
							await manager.update();

							const events: IPackageEventLog[] = [];
							const reset = eventsLogger(manager, events);

							await manager.install(packageNested1.name);
							deepStrictEqual(events, [
								{
									which: 'install-before',
									package: 'package-nested-1'
								},
								{
									which: 'download-before',
									package: 'package-nested-1'
								},
								{
									which: 'download-progress',
									package: 'package-nested-1'
								},
								{
									which: 'download-progress',
									package: 'package-nested-1'
								},
								{
									which: 'download-after',
									package: 'package-nested-1'
								},
								{
									which: 'install-after',
									package: 'package-nested-1'
								}
							]);

							reset();
							await manager.install(packageNested1.name);
							deepStrictEqual(events, [
								{
									which: 'install-current',
									package: 'package-nested-1'
								}
							]);
						}
					)
				);
			});

			void describe('nested level: 2', () => {
				void it(
					'files',
					managerTestOneWith(
						JSON.stringify(packages),
						async manager => {
							await manager.update();

							await manager.install(packageNested.name);

							strictEqual(
								await managerFileSha256(manager, [
									packageNested.name,
									packageNested.file
								]),
								packageNested.sha256
							);
							strictEqual(
								await managerFileExists(manager, [
									packageNested.name,
									manager.metaDir,
									manager.packageFile
								]),
								true
							);

							strictEqual(
								await managerDirExists(manager, [
									packageNested1.name
								]),
								false
							);

							strictEqual(
								await managerDirExists(manager, [
									packageNested2.name
								]),
								false
							);
						}
					)
				);

				void it(
					'return',
					managerTestOneWith(
						JSON.stringify(packages),
						async manager => {
							await manager.update();

							const a = await manager.install(packageNested.name);
							const b = await manager.install(packageNested.name);

							const aValues = a.map(p => p.name);
							deepStrictEqual(aValues, [
								packageNested2.name,
								packageNested1.name,
								packageNested.name
							]);
							deepStrictEqual(b, []);
						}
					)
				);

				void it(
					'events',
					managerTestOneWith(
						JSON.stringify(packages),
						async manager => {
							await manager.update();

							const events: IPackageEventLog[] = [];
							const reset = eventsLogger(manager, events);

							await manager.install(packageNested.name);
							deepStrictEqual(events, [
								{
									which: 'install-before',
									package: 'package-nested'
								},
								{
									which: 'download-before',
									package: 'package-nested'
								},
								{
									which: 'download-progress',
									package: 'package-nested'
								},
								{
									which: 'download-progress',
									package: 'package-nested'
								},
								{
									which: 'download-after',
									package: 'package-nested'
								},
								{
									which: 'install-after',
									package: 'package-nested'
								}
							]);

							reset();
							await manager.install(packageNested.name);
							deepStrictEqual(events, [
								{
									which: 'install-current',
									package: 'package-nested'
								}
							]);
						}
					)
				);
			});

			void describe('reuse closest: 1', () => {
				void it(
					'events',
					managerTestOneWith(
						JSON.stringify(packages),
						async manager => {
							await manager.update();

							await manager.install(packageNested1.name);
							strictEqual(
								await managerFileSha256(manager, [
									packageNested1.name,
									packageNested1.file
								]),
								packageNested1.sha256
							);

							const events: IPackageEventLog[] = [];
							const reset = eventsLogger(manager, events);
							await manager.install(packageNested.name);
							deepStrictEqual(events, [
								{
									which: 'install-before',
									package: 'package-nested'
								},
								{
									which: 'extract-before',
									package: 'package-nested'
								},
								{
									which: 'extract-progress',
									package: 'package-nested'
								},
								{
									which: 'extract-progress',
									package: 'package-nested'
								},
								{
									which: 'extract-after',
									package: 'package-nested'
								},
								{
									which: 'install-after',
									package: 'package-nested'
								}
							]);
							reset();
						}
					)
				);
			});

			void describe('reuse closest: 2', () => {
				void it(
					'events',
					managerTestOneWith(
						JSON.stringify(packages),
						async manager => {
							await manager.update();

							await manager.install(packageNested2.name);
							strictEqual(
								await managerFileSha256(manager, [
									packageNested2.name,
									packageNested2.file
								]),
								packageNested2.sha256
							);

							const events: IPackageEventLog[] = [];
							const reset = eventsLogger(manager, events);
							await manager.install(packageNested.name);
							deepStrictEqual(events, [
								{
									which: 'install-before',
									package: 'package-nested'
								},
								{
									which: 'extract-before',
									package: 'package-nested'
								},
								{
									which: 'extract-progress',
									package: 'package-nested'
								},
								{
									which: 'extract-progress',
									package: 'package-nested'
								},
								{
									which: 'extract-after',
									package: 'package-nested'
								},
								{
									which: 'install-after',
									package: 'package-nested'
								}
							]);
							reset();
						}
					)
				);
			});

			void describe('reuse closest: 2, outdated 1', () => {
				void it(
					'events',
					managerTestOneWith(
						JSON.stringify(packages),
						async manager => {
							await manager.update();

							await manager.install(packageNested2.name);
							strictEqual(
								await managerFileSha256(manager, [
									packageNested2.name,
									packageNested2.file
								]),
								packageNested2.sha256
							);

							await managerWritePackageMeta(
								manager,
								packageNested1MetaBad.name,
								packageNested1MetaBad
							);
							deepStrictEqual(
								(await manager.outdated()).map(p => p.name),
								['package-nested-1']
							);

							const events: IPackageEventLog[] = [];
							const reset = eventsLogger(manager, events);
							await manager.install(packageNested.name);
							deepStrictEqual(events, [
								{
									which: 'install-before',
									package: 'package-nested'
								},
								{
									which: 'extract-before',
									package: 'package-nested'
								},
								{
									which: 'extract-progress',
									package: 'package-nested'
								},
								{
									which: 'extract-progress',
									package: 'package-nested'
								},
								{
									which: 'extract-after',
									package: 'package-nested'
								},
								{
									which: 'install-after',
									package: 'package-nested'
								}
							]);
							reset();

							deepStrictEqual(
								(await manager.outdated()).map(p => p.name),
								['package-nested-1']
							);
						}
					)
				);
			});
		});

		void describe('outdated', () => {
			testMethodAsync(async manager => manager.outdated());

			void it(
				'return',
				managerTestOneWith(JSON.stringify(packages), async manager => {
					await manager.update();

					await manager.install(packageSingle.name);

					await managerWritePackageMeta(
						manager,
						packageNested1MetaBad.name,
						packageNested1MetaBad
					);

					const list = await manager.outdated();

					const listNames = list.map(pkg => pkg.name);
					deepStrictEqual(listNames, [packageNested1.name]);
				})
			);
		});

		void describe('upgrade', () => {
			testMethodAsync(async manager => manager.upgrade());

			void it(
				'files',
				managerTestOneWith(JSON.stringify(packages), async manager => {
					await manager.update();

					await manager.install(packageSingle.name);

					await managerWritePackageMeta(
						manager,
						packageNested1MetaBad.name,
						packageNested1MetaBad
					);

					await manager.upgrade();

					strictEqual(
						await manager.isCurrent(packageNested1.name),
						true
					);
					strictEqual(
						await manager.isInstalled(packageNested2.name),
						false
					);
				})
			);

			void it(
				'return',
				managerTestOneWith(JSON.stringify(packages), async manager => {
					await manager.update();

					await manager.install(packageSingle.name);

					await managerWritePackageMeta(
						manager,
						packageNested1MetaBad.name,
						packageNested1MetaBad
					);

					const a = await manager.upgrade();
					const b = await manager.upgrade();

					const aValues = a.map(p => ({
						name: p.package.name,
						install: p.install.map(p => p.name)
					}));
					deepStrictEqual(aValues, [
						{
							name: packageNested1.name,
							install: [packageNested2.name, packageNested1.name]
						}
					]);
					deepStrictEqual(b, []);
				})
			);

			void it(
				'events',
				managerTestOneWith(JSON.stringify(packages), async manager => {
					await manager.update();

					await manager.install(packageSingle.name);

					await managerWritePackageMeta(
						manager,
						packageNested1MetaBad.name,
						packageNested1MetaBad
					);

					const events: IPackageEventLog[] = [];
					const reset = eventsLogger(manager, events);

					await manager.upgrade();
					deepStrictEqual(events, [
						{
							which: 'install-before',
							package: 'package-nested-1'
						},
						{
							which: 'download-before',
							package: 'package-nested-1'
						},
						{
							which: 'download-progress',
							package: 'package-nested-1'
						},
						{
							which: 'download-progress',
							package: 'package-nested-1'
						},
						{
							which: 'download-after',
							package: 'package-nested-1'
						},
						{
							which: 'install-after',
							package: 'package-nested-1'
						}
					]);

					reset();
					await manager.upgrade();
					deepStrictEqual(events, []);
				})
			);
		});

		void describe('installed', () => {
			testMethodAsync(async manager => manager.installed());

			void it(
				'return',
				managerTestOneWith(JSON.stringify(packages), async manager => {
					await manager.update();

					await manager.install(packageSingle.name);

					await managerWritePackageMeta(
						manager,
						packageNested1MetaBad.name,
						packageNested1MetaBad
					);

					const list = (await manager.installed()).map(s => s.name);
					deepStrictEqual(list, [
						packageNested1.name,
						packageSingle.name
					]);
				})
			);
		});

		void describe('packageInstallReceipt', () => {
			testMethodAsync(async manager =>
				manager.packageInstallReceipt(packageSingle.name)
			);

			void it(
				'return',
				managerTestOneWith(JSON.stringify(packages), async manager => {
					await manager.update();

					await manager.install(packageSingle.name);

					await managerWritePackageMeta(
						manager,
						packageNested1MetaBad.name,
						packageNested1MetaBad
					);

					const receipt = await manager.packageInstallReceipt(
						packageSingle.name
					);

					const receiptBad = await manager.packageInstallReceipt(
						packageNested1MetaBad.name
					);

					strictEqual(receipt.name, packageSingle.name);
					strictEqual(receipt.file, packageSingle.file);
					strictEqual(receipt.size, packageSingle.size);
					strictEqual(receipt.sha256, packageSingle.sha256);

					strictEqual(receiptBad.name, packageNested1MetaBad.name);
					strictEqual(receiptBad.file, packageNested1MetaBad.file);
					strictEqual(receiptBad.size, packageNested1MetaBad.size);
					strictEqual(
						receiptBad.sha256,
						packageNested1MetaBad.sha256
					);
				})
			);
		});

		void describe('packageInstallFile', () => {
			testMethodAsync(async manager =>
				manager.packageInstallFile(packageSingle.name)
			);

			void it(
				'return',
				managerTestOneWith(JSON.stringify(packages), async manager => {
					await manager.update();

					await manager.install(packageSingle.name);

					await managerWritePackageMeta(
						manager,
						packageNested1MetaBad.name,
						packageNested1MetaBad
					);

					const filePath = await manager.packageInstallFile(
						packageSingle.name
					);
					const filePathExpected = manager.pathToPackage(
						packageSingle.name,
						packageSingle.file
					);

					const filePathBad = await manager.packageInstallFile(
						packageNested1MetaBad.name
					);
					const filePathBadExpected = manager.pathToPackage(
						packageNested1MetaBad.name,
						packageNested1MetaBad.file
					);

					strictEqual(filePath, filePathExpected);

					strictEqual(filePathBad, filePathBadExpected);
				})
			);
		});

		void describe('packageInstallFile', () => {
			testMethodAsync(async manager =>
				manager.packageInstallVerify(packageSingle.name)
			);

			void it(
				'installed',
				managerTestOneWith(JSON.stringify(packages), async manager => {
					await manager.update();

					await manager.install(packageSingle.name);

					await manager.packageInstallVerify(packageSingle.name);

					strictEqual(true, true);
				})
			);

			void it(
				'not installed',
				managerTestOneWith(JSON.stringify(packages), async manager => {
					await manager.update();

					// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
					const error = await promiseError(
						manager.packageInstallVerify(packageSingle.name)
					);

					// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
					strictEqual(
						(error as Error).message,
						`Package is not installed: ${packageSingle.name}`
					);
				})
			);

			void it(
				'bad size',
				managerTestOneWith(JSON.stringify(packages), async manager => {
					await manager.update();

					await manager.install(packageSingle.name);

					const file = await manager.packageInstallFile(
						packageSingle.name
					);
					const size = packageSingle.size + 1;
					const data = Buffer.alloc(size);
					await writeFile(file, data);

					// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
					const error = await promiseError(
						manager.packageInstallVerify(packageSingle.name)
					);

					// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
					strictEqual(error.message, `Invalid file size: ${size}`);
				})
			);

			void it(
				'bad sha256',
				managerTestOneWith(JSON.stringify(packages), async manager => {
					await manager.update();

					await manager.install(packageSingle.name);

					const file = await manager.packageInstallFile(
						packageSingle.name
					);
					const {size} = packageSingle;
					const data = Buffer.alloc(size);
					const hash = sha256Buffer(data);
					await writeFile(file, data);

					// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
					const error = await promiseError(
						manager.packageInstallVerify(packageSingle.name)
					);

					// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
					strictEqual(error.message, `Invalid sha256 hash: ${hash}`);
				})
			);
		});
	});
});
