import {createHash as cryptoCreateHash} from 'crypto';
import {Server} from 'http';
import {parse as urlParse} from 'url';

import express from 'express';
import fse from 'fs-extra';

import {Manager} from './manager';
import {Package} from './package';
import {
	IPackageDownloadProgress,
	IPackageExtractProgress,
	IPackageStreamProgress
} from './types';
import {streamEndError} from './util';

const strReverse = (s: string) => s.split('')
	.reverse()
	.join('');

const tmpPath = './spec/tmp';

const unknownDirEmpty = 'unknown-dir-empty';

const packageObsoleteA = {
	name: 'package-obsolete-a',
	file: 'package-obsolete-a.bin',
	size: 42,
	sha256: '4242424242424242424242424242424242424242424242424242424242424242',
	source: 'http://example.com/package-obsolete-a.bin'
};
const packageObsoleteB = {
	name: 'package-obsolete-b',
	file: 'package-obsolete-b.bin',
	size: 24,
	sha256: '2424242424242424242424242424242424242424242424242424242424242424',
	source: 'http://example.com/package-obsolete-b.bin'
};

const packageSingle = {
	name: 'package-single',
	file: 'package-single.bin',
	size: 366161,
	sha256: '781fea60126eb92dbb97d321eea607c3a65708eb16ed297b697563567a2d4cf2',
	source: '/packages/package-single.bin'
};
const packageMultiA = {
	name: 'package-multi-a',
	file: 'package-multi-a.bin',
	size: 270560,
	sha256: 'd84821ba140cc355bf3b5f54b3c02a40467df267e0d9ca88f34c1a11c152bc7b',
	source: 'package-multi/package-multi-a.bin'
};
const packageMultiB = {
	name: 'package-multi-b',
	file: 'package-multi-b.bin',
	size: 270560,
	sha256: '5bfc83ad4988e63120c317166c985367ed0d6a155efef25f61b9b4837ab65fd1',
	source: 'package-multi/package-multi-b.bin'
};
const packageMulti = {
	name: 'package-multi',
	file: 'package-multi.zip',
	size: 130315,
	sha256: 'b26ebd9b476943895c53ece1fbedb1a3f71741b96bb41386bf31f64858c882d9',
	source: '/packages/package-multi.zip',
	packages: [
		packageMultiA,
		packageMultiB
	]
};
const packageNested = {
	name: 'package-nested',
	file: 'package-nested.bin',
	size: 729267,
	sha256: '93116b4ab456da0d1d721f93673e084b5b80e283f617376bdef600993840c092',
	source: 'package-nested-1/package-nested.bin'
};
const packageNested1 = {
	name: 'package-nested-1',
	file: 'package-nested-1.zip',
	size: 171949,
	sha256: 'cbf960773625011d6788ed7b0e832b2a945ec995bc3c560e28881ffaffb61861',
	source: 'package-nested-2/package-nested-1.zip',
	packages: [
		packageNested
	]
};
const packageNested2 = {
	name: 'package-nested-2',
	file: 'package-nested-2.zip',
	size: 172106,
	sha256: '0cf6f565f2395fae74b4681f5ba51183fee6334e02fa3b1927b8abde718a272b',
	source: '/packages/package-nested-2.zip',
	packages: [
		packageNested1
	]
};

const packages = {
	format: '1.0',
	packages: [
		packageSingle,
		packageMulti,
		packageNested2
	]
};

const packageMultiMeta = {
	name: packageMulti.name,
	file: packageMulti.file,
	size: packageMulti.size,
	sha256: packageMulti.sha256,
	source: packageMulti.source
};

const packageSingleMetaBad = {
	name: packageSingle.name,
	file: packageSingle.file,
	size: packageSingle.size + 1,
	sha256: strReverse(packageSingle.sha256),
	source: `https://example.com${packageSingle.source}`
};

const packageNested1MetaBad = {
	name: packageNested1.name,
	file: packageNested1.file,
	size: packageNested1.size + 1,
	sha256: strReverse(packageNested1.sha256),
	source: packageNested1.source
};

function packagesCopy() {
	return JSON.parse(JSON.stringify(packages)) as typeof packages;
}

interface IPackageEventLog {

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
	public async $testExclusiveAsync(func: (self: this) => Promise<any>) {
		const err = await this._exclusiveAsync(async () => {
			try {
				await func.call(this, this);
			}
			catch (err) {
				return err;
			}
			throw new Error('Failed to get error');
		});
		expect(err).toBeTruthy();
		expect(err.message).toBe('Already running exclusive method');
	}

	/**
	 * Test that code throws during _exclusiveSync.
	 *
	 * @param func Test function.
	 */
	public $testExclusiveSync(func: (self: this) => any) {
		// eslint-disable-next-line no-sync
		const err = this._exclusiveSync(() => {
			try {
				func.call(this, this);
			}
			catch (err) {
				return err;
			}
			throw new Error('Failed to get error');
		});
		expect(err).toBeTruthy();
		expect(err.message).toBe('Already running exclusive method');
	}
}

/**
 * Get the error from a promise.
 *
 * @param p Promise object.
 * @returns The error or undefined.
 */
async function promiseError(p: Promise<any>) {
	try {
		await p;
	}
	catch (err) {
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
async function createServer(packages: string) {
	const protocol = 'http:';
	const hostname = '127.0.0.1';
	let errors = false;

	const app = express();
	let host = '';

	const server = await new Promise<Server>((resolve, reject) => {
		let inited = false;
		app.on('error', err => {
			errors = true;
			if (inited) {
				// eslint-disable-next-line no-console
				console.error(err);
				return;
			}
			inited = true;
			reject(err);
		});
		app.get('/packages.json', (req, res) => {
			// eslint-disable-next-line no-use-before-define
			const reqHost = req.headers.host || host;
			const data = JSON.parse(packages);
			for (const pkg of (data.packages || [])) {
				pkg.source = `${protocol}//${reqHost}${pkg.source}`;
			}
			res.send(JSON.stringify(data, null, '\t'));
		});
		app.use('/packages', express.static('spec/fixtures/packages'));
		const server = app.listen(0, () => {
			if (inited) {
				return;
			}
			inited = true;
			resolve(server);
		});
	});

	const address = server.address();
	// eslint-disable-next-line no-nested-ternary
	const port = typeof address === 'string' ?
		Number(urlParse(address).port) :
		(address ? address.port : null);
	if (!port) {
		throw new Error(`Failed to get port from ${address}`);
	}
	host = `${hostname}:${port}`;
	const url = `${protocol}//${host}`;

	const close = async () => {
		await new Promise(resolve => {
			server.close(() => {
				resolve();
			});
		});
		if (errors) {
			throw new Error('Server throw errors while serving requests');
		}
	};

	return {
		app,
		server,
		protocol,
		hostname,
		host,
		port,
		url,
		close
	};
}

/**
 * SHA256 hash a buffer.
 *
 * @param buffer The buffer.
 * @returns SHA256 hash.
 */
function sha256Buffer(buffer: Buffer) {
	const hasher = cryptoCreateHash('sha256');
	hasher.update(buffer);
	return hasher.digest('hex').toLowerCase();
}

/**
 * Ensure driectories in a manager instance.
 *
 * @param manager Manager instance.
 * @param dirs Directory paths.
 */
async function managerEnsureDirs(manager: ManagerTest, dirs: string[][]) {
	await Promise.all(dirs.map(async a => fse.ensureDir(manager.pathTo(...a))));
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
	info: any
) {
	const f = manager.pathTo(pkg, manager.metaDir, manager.packageFile);
	await fse.outputJson(f, info, {spaces: '\t'});
}

/**
 * Check if file exists in a manager instance.
 *
 * @param manager Manager instance.
 * @param path File path.
 * @returns True if file, false if anything else or not exist.
 */
async function managerFileExists(manager: ManagerTest, path: string[]) {
	const fp = manager.pathTo(...path);
	try {
		const stat = await fse.lstat(fp);
		return stat.isFile();
	}
	catch (err) {
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
	const fp = manager.pathTo(...path);
	try {
		const stat = await fse.lstat(fp);
		return stat.isDirectory();
	}
	catch (err) {
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
	const fp = manager.pathTo(...path);
	const hasher = cryptoCreateHash('sha256');
	const f = fse.createReadStream(fp);
	f.on('data', hasher.update.bind(hasher));
	await streamEndError(f, 'close');
	return hasher.digest('hex').toLowerCase();
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
		const localServer = typeof packages === 'string' ?
			await createServer(packages) : null;

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
		}
		finally {
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
	func: (manager: ManagerTest) => Promise<any>
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
	func: (manager: ManagerTest) => Promise<any>
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
	func: (manager: ManagerTest) => Promise<any>
) {
	return managerTestOne(null, async manager => {
		const err = await promiseError(func(manager));
		expect(err).toBeTruthy();
		expect(err.message).toBe('Instance uninitialized');
	});
}

/**
 * Run not active test, sync.
 *
 * @param func Test function.
 * @returns Spec handler.
 */
function managerTestNotActiveSync(
	func: (manager: ManagerTest) => any
) {
	return managerTestOne(null, async manager => {
		let err: any = null;
		try {
			func(manager);
		}
		catch (ex) {
			err = ex;
		}
		expect(err).toBeTruthy();
		expect(err.message).toBe('Instance uninitialized');
	});
}

/**
 * Run not loaded test, async.
 *
 * @param func Test function.
 * @returns Spec handler.
 */
function managerTestNotLoadedAsync(
	func: (manager: ManagerTest) => Promise<any>
) {
	return managerTestOneWith(null, async manager => {
		const err = await promiseError(func(manager));
		expect(err).toBeTruthy();
		expect(err.message).toBe('Packages list not loaded');
	});
}

/**
 * Run not loaded test, sync.
 *
 * @param func Test function.
 * @returns Spec handler.
 */
function managerTestNotLoadedSync(
	func: (manager: ManagerTest) => any
) {
	return managerTestOneWith(null, async manager => {
		let err: any = null;
		try {
			func(manager);
		}
		catch (ex) {
			err = ex;
		}
		expect(err).toBeTruthy();
		expect(err.message).toBe('Packages list not loaded');
	});
}

/**
 * Run exclusive async test.
 *
 * @param func Test function.
 * @returns Spec handler.
 */
function managerTestExclusiveAsync(
	func: (manager: ManagerTest) => Promise<any>
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
function managerTestExclusiveSync(
	func: (manager: ManagerTest) => any
) {
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
	func: (manager: ManagerTest) => Promise<any>,
	loaded = true
) {
	it('exclusive', managerTestExclusiveAsync(func));

	it('not active', managerTestNotActiveAsync(func));

	if (loaded) {
		it('not loaded', managerTestNotLoadedAsync(func));
	}
}

/**
 * Tests for methods, sync.
 *
 * @param func Function to test method.
 * @param loaded Require loaded.
 */
function testMethodSync(
	func: (manager: ManagerTest) => any,
	loaded = true
) {
	// eslint-disable-next-line no-sync
	it('exclusive', managerTestExclusiveSync(func));

	// eslint-disable-next-line no-sync
	it('not active', managerTestNotActiveSync(func));

	if (loaded) {
		// eslint-disable-next-line no-sync
		it('not loaded', managerTestNotLoadedSync(func));
	}
}

/**
 * Events logger.
 *
 * @param manager Manager instance.
 * @param events Events ordered.
 * @param eventsNoStream Events ordered, excluding stream events.
 * @returns Reset function to reset the lists.
 */
function eventsLogger(
	manager: ManagerTest,
	events: IPackageEventLog[] = [],
	eventsNoStream: IPackageEventLog[] = []
) {
	let prevDownloadProgress: IPackageDownloadProgress | null = null;
	let prevStreamProgress: IPackageStreamProgress | null = null;
	let prevExtractProgress: IPackageExtractProgress | null = null;

	const add = (o: IPackageEventLog) => {
		events.push(o);
		if (!o.which.startsWith('stream-')) {
			eventsNoStream.push(o);
		}
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

	manager.eventPackageStreamBefore.on(event => {
		add({
			which: 'stream-before',
			package: event.package.name
		});
	});
	manager.eventPackageStreamProgress.on(event => {
		const start = event.amount === 0;
		const end = event.amount === event.total;

		if (event.amount > event.total) {
			throw new Error('Stream progress: Over amount');
		}
		if (prevStreamProgress && !start) {
			if (event.total !== prevStreamProgress.total) {
				throw new Error('Stream progress: Total changed');
			}
			if (event.amount <= prevStreamProgress.amount) {
				throw new Error('Stream progress: No progress');
			}
		}

		// Only add first and last progress.
		if (start || end) {
			add({
				which: 'stream-progress',
				package: event.package.name
			});
		}
		prevStreamProgress = event;
	});
	manager.eventPackageStreamAfter.on(event => {
		add({
			which: 'stream-after',
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
		prevStreamProgress = null;
		prevExtractProgress = null;
		events.splice(0, events.length);
		eventsNoStream.splice(0, eventsNoStream.length);
	};
}

describe('manager', () => {
	describe('Manager', () => {
		beforeEach(async () => {
			await fse.remove(tmpPath);
		});

		afterEach(async () => {
			await fse.remove(tmpPath);
		});

		describe('init + destroy', () => {
			it('simple', managerTestOne(null, async manager => {
				await manager.init();
				await manager.destroy();
			}));

			it('init once', managerTestOne(null, async manager => {
				await manager.init();
				const err = await promiseError(manager.init());
				expect(err).toBeTruthy();
				expect(err.message).toBe('Instance initialized');
				await manager.destroy();
			}));

			it('destroy once', managerTestOne(null, async manager => {
				await manager.init();
				await manager.destroy();
				const err = await promiseError(manager.destroy());
				expect(err).toBeTruthy();
				expect(err.message).toBe('Instance uninitialized');
			}));

			it('init exclusive', managerTestOne(
				JSON.stringify(packages),
				async manager => {
					await manager.$testExclusiveAsync(async () => {
						await manager.init();
					});
				}
			));

			it('destroy exclusive', managerTestOne(
				JSON.stringify(packages),
				async manager => {
					await manager.init();
					await manager.$testExclusiveAsync(async () => {
						await manager.destroy();
					});
					await manager.destroy();
				}
			));

			it('init destroy 2x', managerTest(null, async ManagerTest => {
				const manager1 = new ManagerTest(tmpPath);
				await manager1.init();
				await manager1.destroy();

				const manager2 = new ManagerTest(tmpPath);
				await manager2.init();
				await manager2.destroy();
			}));

			it('init locked', managerTest(null, async ManagerTest => {
				const manager1 = new ManagerTest(tmpPath);
				const manager2 = new ManagerTest(tmpPath);

				await manager1.init();
				const err = await promiseError(manager2.init());
				expect(err).toBeTruthy();
				expect(err.message).toBe('Lock file is already being held');
			}));

			it('init destroy 2x reuse', managerTest(null, async ManagerTest => {
				const manager = new ManagerTest(tmpPath);
				await manager.init();
				await manager.destroy();
				await manager.init();
				// await manager.destroy();
			}));
		});

		describe('with', () => {
			it('active', managerTestOne(null, async manager => {
				expect(manager.active).toBe(false);
				await manager.with(async manager => {
					expect(manager.active).toBe(true);
				});
				expect(manager.active).toBe(false);
			}));

			it('reuse', managerTestOne(null, async manager => {
				expect(manager.active).toBe(false);
				await manager.with(async manager => {
					expect(manager.active).toBe(true);
				});
				await manager.with(async manager => {
					expect(manager.active).toBe(true);
				});
				expect(manager.active).toBe(false);
			}));

			it('throws', managerTestOne(null, async manager => {
				expect(manager.active).toBe(false);
				const thrown = new Error('With throws');
				const err = await promiseError(manager.with(
					manager => {
						expect(manager.active).toBe(true);
						throw thrown;
					}
				));
				expect(err).toBe(thrown);
				expect(manager.active).toBe(false);
			}));

			it('directory', managerTestOne(null, async manager => {
				await manager.with(async manager => {
					expect(manager.active).toBe(true);

					const statTmpPath = await fse.lstat(tmpPath);
					expect(statTmpPath.isDirectory()).toBe(true);

					const statMetaDir = await fse.lstat(
						manager.pathMeta
					);
					expect(statMetaDir.isDirectory()).toBe(true);
				});

				const statTmpPath = await fse.lstat(tmpPath);
				expect(statTmpPath.isDirectory()).toBe(true);

				const statMetaDir = await fse.lstat(manager.pathMeta);
				expect(statMetaDir.isDirectory()).toBe(true);
			}));
		});

		describe('update', () => {
			testMethodAsync(
				async manager => manager.update(),
				false
			);

			it('loaded', managerTestOne(
				JSON.stringify(packages),
				async manager => {
					await manager.init();
					expect(manager.loaded).toBe(false);
					await manager.update();
					expect(manager.loaded).toBe(true);
				}
			));

			it('load from disk', managerTest(
				JSON.stringify(packages),
				async ManagerTest => {
					const manager1 = new ManagerTest(tmpPath);
					await manager1.with(async manager => {
						expect(manager.loaded).toBe(false);
						await manager.update();
						expect(manager.loaded).toBe(true);
					});

					const manager2 = new ManagerTest(tmpPath);
					await manager2.with(async manager => {
						expect(manager.loaded).toBe(true);
					});
				}
			));

			describe('return', () => {
				const writePackage = async (manager: Manager, obj: any) => {
					const jsonFile = manager.pathToMeta(manager.packagesFile);
					await fse.outputJson(jsonFile, obj, {spaces: '\t'});
				};

				it('added', managerTestOne(
					JSON.stringify(packages),
					async manager => {
						const mod = packagesCopy();
						mod.packages = mod.packages
							.filter((p: any) => p.name !== packageMulti.name);

						await writePackage(manager, mod);

						const report = await manager
							.with(async manager => manager.update());

						expect(report.updated).toEqual([]);
						expect(report.added.map(p => p.name)).toEqual([
							'package-multi',
							'package-multi-a',
							'package-multi-b'
						]);
						expect(report.removed).toEqual([]);
					}
				));

				it('removed', managerTestOne(
					JSON.stringify(packages),
					async manager => {
						const mod = packagesCopy();
						mod.packages.push(
							packageObsoleteA,
							packageObsoleteB
						);

						await writePackage(manager, mod);

						const report = await manager
							.with(async manager => manager.update());

						expect(report.updated).toEqual([]);
						expect(report.added).toEqual([]);
						expect(report.removed.map(p => p.name)).toEqual([
							packageObsoleteA.name,
							packageObsoleteB.name
						]);
					}
				));

				it('updated: file', managerTestOne(
					JSON.stringify(packages),
					async manager => {
						const mod = packagesCopy();
						const [pkg] = mod.packages;
						pkg.file += '.old';
						await writePackage(manager, mod);

						const report = await manager
							.with(async manager => manager.update());

						expect(report.updated.map(p => p.name)).toEqual([
							pkg.name
						]);
						expect(report.added).toEqual([]);
						expect(report.removed).toEqual([]);
					}
				));

				it('updated: size', managerTestOne(
					JSON.stringify(packages),
					async manager => {
						const mod = packagesCopy();
						const [pkg] = mod.packages;
						pkg.size++;
						await writePackage(manager, mod);

						const report = await manager
							.with(async manager => manager.update());

						expect(report.updated.map(p => p.name)).toEqual([
							pkg.name
						]);
						expect(report.added).toEqual([]);
						expect(report.removed).toEqual([]);
					}
				));

				it('updated: sha256', managerTestOne(
					JSON.stringify(packages),
					async manager => {
						const mod = packagesCopy();
						const [pkg] = mod.packages;
						pkg.sha256 = strReverse(pkg.sha256);
						await writePackage(manager, mod);

						const report = await manager
							.with(async manager => manager.update());

						expect(report.updated.map(p => p.name)).toEqual([
							pkg.name
						]);
						expect(report.added).toEqual([]);
						expect(report.removed).toEqual([]);
					}
				));

				it('ignored: source', managerTestOne(
					JSON.stringify(packages),
					async manager => {
						const mod = packagesCopy();
						const [pkg] = mod.packages;
						pkg.source += '.old';
						await writePackage(manager, mod);

						const report = await manager
							.with(async manager => manager.update());

						expect(report.updated).toEqual([]);
						expect(report.added).toEqual([]);
						expect(report.removed).toEqual([]);
					}
				));
			});
		});

		describe('packageItter', () => {
			it('return', managerTestOneWith(
				JSON.stringify(packages),
				async manager => {
					await manager.update();

					const expected = [
						packageSingle,
						packageMulti,
						packageMultiA,
						packageMultiB,
						packageNested2,
						packageNested1,
						packageNested
					]
						.map(p => p.name);

					const listed = [...manager.packageItter()]
						.map(p => p.name);

					expect(listed).toEqual(expected);
				}
			));
		});

		describe('packageByName', () => {
			// eslint-disable-next-line no-sync
			testMethodSync(
				manager => manager.packageByName(packageSingle.name)
			);

			it('return', managerTestOneWith(
				JSON.stringify(packages),
				async manager => {
					await manager.update();

					expect(manager.packageByName(packageObsoleteA.name))
						.toBeNull();

					expect(manager.packageByName(
						packageSingle.name
					)).toBeTruthy();
				}
			));
		});

		describe('packageBySha256', () => {
			// eslint-disable-next-line no-sync
			testMethodSync(
				manager => manager.packageBySha256(packageSingle.sha256)
			);

			it('return', managerTestOneWith(
				JSON.stringify(packages),
				async manager => {
					await manager.update();

					expect(manager.packageBySha256(
						packageSingleMetaBad.sha256
					)).toBeNull();

					expect(manager.packageBySha256(
						packageSingle.sha256
					)).toBeTruthy();
				}
			));
		});

		describe('packageByUnique', () => {
			// eslint-disable-next-line no-sync
			testMethodSync(
				manager => manager.packageByUnique(packageSingle.name)
			);

			it('return', managerTestOneWith(
				JSON.stringify(packages),
				async manager => {
					await manager.update();

					expect(manager.packageByUnique(
						packageObsoleteA.name
					)).toBeNull();
					expect(manager.packageByUnique(
						packageSingleMetaBad.sha256
					)).toBeNull();

					expect(manager.packageByUnique(
						packageSingle.name
					)).toBeTruthy();
					expect(manager.packageByUnique(
						packageSingle.sha256
					)).toBeTruthy();
				}
			));
		});

		describe('packageIsMember', () => {
			const packageSingleFake = new Package(packageSingle);

			// eslint-disable-next-line no-sync
			testMethodSync(
				manager => manager.packageIsMember(packageSingleFake)
			);

			it('return', managerTestOneWith(
				JSON.stringify(packages),
				async manager => {
					await manager.update();

					expect(manager.packageIsMember(packageSingleFake))
						.toBe(false);

					const packageSingleReal = manager.packageByName(
						packageSingle.name
					);
					expect(packageSingleReal).toBeTruthy();
					if (packageSingleReal) {
						expect(manager.packageIsMember(packageSingleReal))
							.toBe(true);
					}
				}
			));
		});

		describe('isObsolete', () => {
			testMethodAsync(
				async manager => manager.isObsolete(packageSingle.name)
			);

			it('return', managerTestOneWith(
				JSON.stringify(packages),
				async manager => {
					await manager.update();

					await managerEnsureDirs(manager, [
						[unknownDirEmpty],
						[packageSingle.name, manager.metaDir],
						[packageObsoleteA.name, manager.metaDir],
						[packageObsoleteB.name, manager.metaDir]
					]);

					expect(await manager.isObsolete(unknownDirEmpty))
						.toBe(false);
					expect(await manager.isObsolete(packageSingle.name))
						.toBe(false);
					expect(await manager.isObsolete(packageObsoleteA.name))
						.toBe(true);
					expect(await manager.isObsolete(packageObsoleteB.name))
						.toBe(true);
				}
			));
		});

		describe('isInstalled', () => {
			testMethodAsync(
				async manager => manager.isInstalled(packageSingle.name)
			);

			it('return', managerTestOneWith(
				JSON.stringify(packages),
				async manager => {
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

					expect(await manager.isInstalled(packageSingle.name))
						.toBe(true);
					expect(await manager.isInstalled(packageMulti.name))
						.toBe(true);
				}
			));
		});

		describe('isCurrent', () => {
			testMethodAsync(
				async manager => manager.isCurrent(packageSingle.name)
			);

			it('return', managerTestOneWith(
				JSON.stringify(packages),
				async manager => {
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

					expect(await manager.isCurrent(packageSingle.name))
						.toBe(false);
					expect(await manager.isCurrent(packageMulti.name))
						.toBe(true);
				}
			));
		});

		describe('obsolete', () => {
			testMethodAsync(
				async manager => manager.obsolete()
			);

			it('return', managerTestOneWith(
				JSON.stringify(packages),
				async manager => {
					await manager.update();

					await managerEnsureDirs(manager, [
						[unknownDirEmpty],
						[packageSingle.name, manager.metaDir],
						[packageObsoleteA.name, manager.metaDir],
						[packageObsoleteB.name, manager.metaDir]
					]);

					const obsolete = await manager.obsolete();

					const obsoleteSorted = [...obsolete].sort();
					expect(obsoleteSorted).toEqual([
						packageObsoleteA.name,
						packageObsoleteB.name
					]);
				}
			));
		});

		describe('cleanup', () => {
			testMethodAsync(
				async manager => manager.cleanup()
			);

			it('files', managerTestOneWith(
				JSON.stringify(packages),
				async manager => {
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

					expect(await managerDirExists(
						manager,
						[unknownDirEmpty]
					)).toBe(true);
					expect(await managerDirExists(
						manager,
						[packageSingle.name]
					)).toBe(true);
					expect(await managerDirExists(
						manager,
						[packageObsoleteA.name]
					)).toBe(false);
					expect(await managerDirExists(
						manager,
						[packageObsoleteB.name]
					)).toBe(false);
				}
			));

			it('return', managerTestOneWith(
				JSON.stringify(packages),
				async manager => {
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

					expect(a).toEqual([
						{
							package: packageObsoleteA.name,
							removed: true
						},
						{
							package: packageObsoleteB.name,
							removed: true
						}
					]);
					expect(b).toEqual([]);
				}
			));

			it('events', managerTestOneWith(
				JSON.stringify(packages),
				async manager => {
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
					expect(events).toEqual([
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
					expect(events).toEqual([]);
				}
			));
		});

		describe('remove', () => {
			testMethodAsync(
				async manager => manager.remove(packageSingle.name)
			);

			it('files', managerTestOneWith(
				JSON.stringify(packages),
				async manager => {
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

					expect(await managerDirExists(
						manager,
						[unknownDirEmpty]
					)).toBe(false);
					expect(await managerDirExists(
						manager,
						[packageSingle.name]
					)).toBe(false);
					expect(await managerDirExists(
						manager,
						[packageObsoleteA.name]
					)).toBe(false);
					expect(await managerDirExists(
						manager,
						[packageObsoleteB.name]
					)).toBe(false);
				}
			));

			it('return', managerTestOneWith(
				JSON.stringify(packages),
				async manager => {
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

					expect(a1).toBe(true);
					expect(a2).toBe(false);
					expect(b1).toBe(true);
					expect(b2).toBe(false);
					expect(c1).toBe(true);
					expect(c2).toBe(false);
				}
			));
		});

		describe('packagesDependOrdered', () => {
			// eslint-disable-next-line no-sync
			testMethodSync(
				manager => manager.packagesDependOrdered([])
			);

			describe('return', () => {
				it('full', managerTestOneWith(
					JSON.stringify(packages),
					async manager => {
						await manager.update();

						const list = [
							packageNested2.name,
							packageNested1.name,
							packageNested.name
						];
						const listRev = list.slice(0).reverse();

						const ordered = manager.packagesDependOrdered(listRev);

						const orderedStrs = ordered.map(p => p.name);
						expect(orderedStrs).toEqual(list);
					}
				));

				it('skip', managerTestOneWith(
					JSON.stringify(packages),
					async manager => {
						await manager.update();

						const list = [
							packageNested2.name,
							packageNested.name
						];
						const listRev = list.slice(0).reverse();

						const ordered = manager.packagesDependOrdered(listRev);

						const orderedStrs = ordered.map(p => p.name);
						expect(orderedStrs).toEqual(list);
					}
				));
			});
		});

		describe('installFull', () => {
			testMethodAsync(
				async manager => manager.installFull(packageSingle.name)
			);

			describe('single', () => {
				it('files', managerTestOneWith(
					JSON.stringify(packages),
					async manager => {
						await manager.update();

						await manager.installFull(packageSingle.name);

						expect(await managerFileSha256(
							manager,
							[packageSingle.name, 'package-single.bin']
						)).toBe(packageSingle.sha256);
						expect(await managerFileExists(
							manager,
							[
								packageSingle.name,
								manager.metaDir,
								manager.packageFile
							]
						)).toBe(true);
					}
				));

				it('return', managerTestOneWith(
					JSON.stringify(packages),
					async manager => {
						await manager.update();

						const a = await manager.installFull(packageSingle.name);
						const b = await manager.installFull(packageSingle.name);

						const aValues = a.map(p => p.name);
						expect(aValues).toEqual([
							packageSingle.name
						]);
						expect(b).toEqual([]);
					}
				));

				it('events', managerTestOneWith(
					JSON.stringify(packages),
					async manager => {
						await manager.update();

						const events: IPackageEventLog[] = [];
						const reset = eventsLogger(manager, events);

						await manager.installFull(packageSingle.name);
						expect(events).toEqual([
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
						await manager.installFull(packageSingle.name);
						expect(events).toEqual([
							{
								which: 'install-current',
								package: 'package-single'
							}
						]);
					}
				));
			});

			describe('nested', () => {
				it('files', managerTestOneWith(
					JSON.stringify(packages),
					async manager => {
						await manager.update();

						await manager.installFull(packageNested.name);

						expect(await managerFileSha256(
							manager,
							[packageNested.name, 'package-nested.bin']
						)).toBe(packageNested.sha256);
						expect(await managerFileExists(
							manager,
							[
								packageNested.name,
								manager.metaDir,
								manager.packageFile
							]
						)).toBe(true);

						expect(await managerFileSha256(
							manager,
							[packageNested1.name, 'package-nested-1.zip']
						)).toBe(packageNested1.sha256);
						expect(await managerFileExists(
							manager,
							[
								packageNested1.name,
								manager.metaDir,
								manager.packageFile
							]
						)).toBe(true);

						expect(await managerFileSha256(
							manager,
							[packageNested2.name, 'package-nested-2.zip']
						)).toBe(packageNested2.sha256);
						expect(await managerFileExists(
							manager,
							[
								packageNested2.name,
								manager.metaDir,
								manager.packageFile
							]
						)).toBe(true);
					}
				));

				it('return', managerTestOneWith(
					JSON.stringify(packages),
					async manager => {
						await manager.update();

						const a = await manager.installFull(packageNested.name);
						const b = await manager.installFull(packageNested.name);

						const aValues = a.map(p => p.name);
						expect(aValues).toEqual([
							packageNested2.name,
							packageNested1.name,
							packageNested.name
						]);
						expect(b).toEqual([]);
					}
				));

				it('events', managerTestOneWith(
					JSON.stringify(packages),
					async manager => {
						await manager.update();

						const events: IPackageEventLog[] = [];
						const reset = eventsLogger(manager, events);

						await manager.installFull(packageNested.name);
						expect(events).toEqual([
							{
								which: 'install-before',
								package: 'package-nested'
							},
							{
								which: 'download-before',
								package: 'package-nested-2'
							},
							{
								which: 'download-progress',
								package: 'package-nested-2'
							},
							{
								which: 'download-progress',
								package: 'package-nested-2'
							},
							{
								which: 'download-after',
								package: 'package-nested-2'
							},
							{
								which: 'install-after',
								package: 'package-nested'
							},
							{
								which: 'install-before',
								package: 'package-nested'
							},
							{
								which: 'extract-before',
								package: 'package-nested-1'
							},
							{
								which: 'extract-progress',
								package: 'package-nested-1'
							},
							{
								which: 'extract-progress',
								package: 'package-nested-1'
							},
							{
								which: 'extract-after',
								package: 'package-nested-1'
							},
							{
								which: 'install-after',
								package: 'package-nested'
							},
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
						await manager.installFull(packageNested.name);
						expect(events).toEqual([
							{
								which: 'install-current',
								package: 'package-nested'
							}
						]);
					}
				));
			});
		});

		describe('installSlim', () => {
			testMethodAsync(
				async manager => manager.installSlim(packageSingle.name)
			);

			describe('nested level: 0', () => {
				it('files', managerTestOneWith(
					JSON.stringify(packages),
					async manager => {
						await manager.update();

						await manager.installSlim(packageSingle.name);

						expect(await managerFileSha256(
							manager,
							[packageSingle.name, 'package-single.bin']
						)).toBe(packageSingle.sha256);
						expect(await managerFileExists(
							manager,
							[
								packageSingle.name,
								manager.metaDir,
								manager.packageFile
							]
						)).toBe(true);
					}
				));

				it('return', managerTestOneWith(
					JSON.stringify(packages),
					async manager => {
						await manager.update();

						const a = await manager.installSlim(packageSingle.name);
						const b = await manager.installSlim(packageSingle.name);

						const aValues = a.map(p => p.name);
						expect(aValues).toEqual([
							packageSingle.name
						]);
						expect(b).toEqual([]);
					}
				));

				it('events', managerTestOneWith(
					JSON.stringify(packages),
					async manager => {
						await manager.update();

						const events: IPackageEventLog[] = [];
						const reset = eventsLogger(manager, events);

						await manager.installSlim(packageSingle.name);
						expect(events).toEqual([
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
						await manager.installSlim(packageSingle.name);
						expect(events).toEqual([
							{
								which: 'install-current',
								package: 'package-single'
							}
						]);
					}
				));
			});

			describe('nested level: 1', () => {
				it('files', managerTestOneWith(
					JSON.stringify(packages),
					async manager => {
						await manager.update();

						await manager.installSlim(packageNested1.name);

						expect(await managerFileSha256(
							manager,
							[packageNested1.name, 'package-nested-1.zip']
						)).toBe(packageNested1.sha256);
						expect(await managerFileExists(
							manager,
							[
								packageNested1.name,
								manager.metaDir,
								manager.packageFile
							]
						)).toBe(true);

						expect(await managerDirExists(
							manager,
							[packageNested2.name]
						)).toBe(false);
					}
				));

				it('return', managerTestOneWith(
					JSON.stringify(packages),
					async manager => {
						await manager.update();

						const a = await manager.installSlim(
							packageNested1.name
						);
						const b = await manager.installSlim(
							packageNested1.name
						);

						const aValues = a.map(p => p.name);
						expect(aValues).toEqual([
							packageNested1.name
						]);
						expect(b).toEqual([]);
					}
				));

				it('events', managerTestOneWith(
					JSON.stringify(packages),
					async manager => {
						await manager.update();

						const events: IPackageEventLog[] = [];
						const eventsNoStream: IPackageEventLog[] = [];
						const reset = eventsLogger(
							manager,
							events,
							eventsNoStream
						);

						await manager.installSlim(packageNested1.name);
						expect(eventsNoStream).toEqual([
							{
								which: 'install-before',
								package: 'package-nested-1'
							},
							{
								which: 'extract-before',
								package: 'package-nested-1'
							},
							{
								which: 'extract-progress',
								package: 'package-nested-1'
							},
							{
								which: 'extract-progress',
								package: 'package-nested-1'
							},
							{
								which: 'extract-after',
								package: 'package-nested-1'
							},
							{
								which: 'install-after',
								package: 'package-nested-1'
							}
						]);

						reset();
						await manager.installSlim(packageNested1.name);
						expect(events).toEqual([
							{
								which: 'install-current',
								package: 'package-nested-1'
							}
						]);
					}
				));
			});

			describe('nested level: 2', () => {
				it('files', managerTestOneWith(
					JSON.stringify(packages),
					async manager => {
						await manager.update();

						await manager.installSlim(packageNested.name);

						expect(await managerFileSha256(
							manager,
							[packageNested.name, 'package-nested.bin']
						)).toBe(packageNested.sha256);
						expect(await managerFileExists(
							manager,
							[
								packageNested.name,
								manager.metaDir,
								manager.packageFile
							]
						)).toBe(true);

						expect(await managerDirExists(
							manager,
							[packageNested1.name]
						)).toBe(false);

						expect(await managerDirExists(
							manager,
							[packageNested2.name]
						)).toBe(false);
					}
				));

				it('return', managerTestOneWith(
					JSON.stringify(packages),
					async manager => {
						await manager.update();

						const a = await manager.installSlim(packageNested.name);
						const b = await manager.installSlim(packageNested.name);

						const aValues = a.map(p => p.name);
						expect(aValues).toEqual([
							packageNested1.name,
							packageNested.name
						]);
						expect(b).toEqual([]);
					}
				));

				it('events', managerTestOneWith(
					JSON.stringify(packages),
					async manager => {
						await manager.update();

						const events: IPackageEventLog[] = [];
						const eventsNoStream: IPackageEventLog[] = [];
						const reset = eventsLogger(
							manager,
							events,
							eventsNoStream
						);

						await manager.installSlim(packageNested.name);
						expect(eventsNoStream).toEqual([
							{
								which: 'install-before',
								package: 'package-nested'
							},
							{
								which: 'extract-before',
								package: 'package-nested-1'
							},
							{
								which: 'extract-progress',
								package: 'package-nested-1'
							},
							{
								which: 'extract-progress',
								package: 'package-nested-1'
							},
							{
								which: 'extract-after',
								package: 'package-nested-1'
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
						await manager.installSlim(packageNested.name);
						expect(events).toEqual([
							{
								which: 'install-current',
								package: 'package-nested'
							}
						]);
					}
				));
			});
		});

		describe('outdated', () => {
			testMethodAsync(
				async manager => manager.outdated()
			);

			it('return', managerTestOneWith(
				JSON.stringify(packages),
				async manager => {
					await manager.update();

					await manager.installSlim(packageSingle.name);

					await managerWritePackageMeta(
						manager,
						packageNested1MetaBad.name,
						packageNested1MetaBad
					);

					const list = await manager.outdated();

					const listNames = list.map(pkg => pkg.name);
					expect(listNames).toEqual([packageNested1.name]);
				}
			));
		});

		describe('upgradeFull', () => {
			testMethodAsync(
				async manager => manager.upgradeFull()
			);

			it('files', managerTestOneWith(
				JSON.stringify(packages),
				async manager => {
					await manager.update();

					await manager.installSlim(packageSingle.name);

					await managerWritePackageMeta(
						manager,
						packageNested1MetaBad.name,
						packageNested1MetaBad
					);

					await manager.upgradeFull();

					expect(await manager.isCurrent(packageNested1.name))
						.toBe(true);
					expect(await manager.isCurrent(packageNested2.name))
						.toBe(true);
				}
			));

			it('return', managerTestOneWith(
				JSON.stringify(packages),
				async manager => {
					await manager.update();

					await manager.installSlim(packageSingle.name);

					await managerWritePackageMeta(
						manager,
						packageNested1MetaBad.name,
						packageNested1MetaBad
					);

					const a = await manager.upgradeFull();
					const b = await manager.upgradeFull();

					const aValues = a.map(p => ({
						name: p.package.name,
						installed: p.installed.map(p => p.name)
					}));
					expect(aValues).toEqual([{
						name: packageNested1.name,
						installed: [packageNested2.name, packageNested1.name]
					}]);
					expect(b).toEqual([]);
				}
			));

			it('events', managerTestOneWith(
				JSON.stringify(packages),
				async manager => {
					await manager.update();

					await manager.installSlim(packageSingle.name);

					await managerWritePackageMeta(
						manager,
						packageNested1MetaBad.name,
						packageNested1MetaBad
					);

					const events: IPackageEventLog[] = [];
					const reset = eventsLogger(
						manager,
						events
					);

					await manager.upgradeFull();
					expect(events).toEqual([
						{
							which: 'install-before',
							package: 'package-nested-1'
						},
						{
							which: 'download-before',
							package: 'package-nested-2'
						},
						{
							which: 'download-progress',
							package: 'package-nested-2'
						},
						{
							which: 'download-progress',
							package: 'package-nested-2'
						},
						{
							which: 'download-after',
							package: 'package-nested-2'
						},
						{
							which: 'install-after',
							package: 'package-nested-1'
						},
						{
							which: 'install-before',
							package: 'package-nested-1'
						},
						{
							which: 'extract-before',
							package: 'package-nested-1'
						},
						{
							which: 'extract-progress',
							package: 'package-nested-1'
						},
						{
							which: 'extract-progress',
							package: 'package-nested-1'
						},
						{
							which: 'extract-after',
							package: 'package-nested-1'
						},
						{
							which: 'install-after',
							package: 'package-nested-1'
						}
					]);

					reset();
					await manager.upgradeFull();
					expect(events).toEqual([]);
				}
			));
		});

		describe('upgradeSlim', () => {
			testMethodAsync(
				async manager => manager.upgradeSlim()
			);

			it('files', managerTestOneWith(
				JSON.stringify(packages),
				async manager => {
					await manager.update();

					await manager.installSlim(packageSingle.name);

					await managerWritePackageMeta(
						manager,
						packageNested1MetaBad.name,
						packageNested1MetaBad
					);

					await manager.upgradeSlim();

					expect(await manager.isCurrent(packageNested1.name))
						.toBe(true);
					expect(await manager.isInstalled(packageNested2.name))
						.toBe(false);
				}
			));

			it('return', managerTestOneWith(
				JSON.stringify(packages),
				async manager => {
					await manager.update();

					await manager.installSlim(packageSingle.name);

					await managerWritePackageMeta(
						manager,
						packageNested1MetaBad.name,
						packageNested1MetaBad
					);

					const a = await manager.upgradeSlim();
					const b = await manager.upgradeSlim();

					const aValues = a.map(p => ({
						name: p.package.name,
						installed: p.installed.map(p => p.name)
					}));
					expect(aValues).toEqual([{
						name: packageNested1.name,
						installed: [packageNested1.name]
					}]);
					expect(b).toEqual([]);
				}
			));

			it('events', managerTestOneWith(
				JSON.stringify(packages),
				async manager => {
					await manager.update();

					await manager.installSlim(packageSingle.name);

					await managerWritePackageMeta(
						manager,
						packageNested1MetaBad.name,
						packageNested1MetaBad
					);

					const events: IPackageEventLog[] = [];
					const eventsNoStream: IPackageEventLog[] = [];
					const reset = eventsLogger(
						manager,
						events,
						eventsNoStream
					);

					await manager.upgradeSlim();
					expect(eventsNoStream).toEqual([
						{
							which: 'install-before',
							package: 'package-nested-1'
						},
						{
							which: 'extract-before',
							package: 'package-nested-1'
						},
						{
							which: 'extract-progress',
							package: 'package-nested-1'
						},
						{
							which: 'extract-progress',
							package: 'package-nested-1'
						},
						{
							which: 'extract-after',
							package: 'package-nested-1'
						},
						{
							which: 'install-after',
							package: 'package-nested-1'
						}
					]);

					reset();
					await manager.upgradeSlim();
					expect(events).toEqual([]);
				}
			));
		});

		describe('installed', () => {
			testMethodAsync(
				async manager => manager.installed()
			);

			it('return', managerTestOneWith(
				JSON.stringify(packages),
				async manager => {
					await manager.update();

					await manager.installSlim(packageSingle.name);

					await managerWritePackageMeta(
						manager,
						packageNested1MetaBad.name,
						packageNested1MetaBad
					);

					const list = await manager.installed();

					const listNames = list.map(pkg => pkg.name);
					const listNamesExpected = [
						packageNested1.name,
						packageSingle.name
					].sort();
					expect(listNames).toEqual(listNamesExpected);
				}
			));
		});

		describe('packageInstallReceipt', () => {
			testMethodAsync(async manager => manager.packageInstallReceipt(
				packageSingle.name
			));

			it('return', managerTestOneWith(
				JSON.stringify(packages),
				async manager => {
					await manager.update();

					await manager.installSlim(packageSingle.name);

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

					expect(receipt.name).toBe(packageSingle.name);
					expect(receipt.file).toBe(packageSingle.file);
					expect(receipt.size).toBe(packageSingle.size);
					expect(receipt.sha256).toBe(packageSingle.sha256);

					expect(receiptBad.name).toBe(packageNested1MetaBad.name);
					expect(receiptBad.file).toBe(packageNested1MetaBad.file);
					expect(receiptBad.size).toBe(packageNested1MetaBad.size);
					expect(receiptBad.sha256)
						.toBe(packageNested1MetaBad.sha256);
				}
			));
		});

		describe('packageInstallFile', () => {
			testMethodAsync(
				async manager => manager.packageInstallFile(packageSingle.name)
			);

			it('return', managerTestOneWith(
				JSON.stringify(packages),
				async manager => {
					await manager.update();

					await manager.installSlim(packageSingle.name);

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

					expect(filePath).toBe(filePathExpected);

					expect(filePathBad).toBe(filePathBadExpected);
				}
			));
		});

		describe('packageInstallFile', () => {
			testMethodAsync(async manager => manager.packageInstallVerify(
				packageSingle.name
			));

			it('installed', managerTestOneWith(
				JSON.stringify(packages),
				async manager => {
					await manager.update();

					await manager.installSlim(packageSingle.name);

					await manager.packageInstallVerify(packageSingle.name);

					expect(true).toBe(true);
				}
			));

			it('not installed', managerTestOneWith(
				JSON.stringify(packages),
				async manager => {
					await manager.update();

					const error = await promiseError(
						manager.packageInstallVerify(packageSingle.name)
					);

					expect(error.message).toBe('Package is not installed');
				}
			));

			it('bad size', managerTestOneWith(
				JSON.stringify(packages),
				async manager => {
					await manager.update();

					await manager.installSlim(packageSingle.name);

					const fp = await manager.packageInstallFile(
						packageSingle.name
					);
					const {size} = packageSingle;
					const fd = Buffer.alloc(size + 1);
					await fse.outputFile(fp, fd);

					const error = await promiseError(
						manager.packageInstallVerify(packageSingle.name)
					);

					expect(error.message).toBe(
						`Invalid file size: ${fd.length} expected: ${size}`
					);
				}
			));

			it('bad sha256', managerTestOneWith(
				JSON.stringify(packages),
				async manager => {
					await manager.update();

					await manager.installSlim(packageSingle.name);

					const fp = await manager.packageInstallFile(
						packageSingle.name
					);
					const {size, sha256} = packageSingle;
					const fd = Buffer.alloc(size);
					const fdSha256 = sha256Buffer(fd);
					await fse.outputFile(fp, fd);

					const error = await promiseError(
						manager.packageInstallVerify(packageSingle.name)
					);

					expect(error.message).toBe(
						`Invalid sha256 hash: ${fdSha256} expected: ${sha256}`
					);
				}
			));
		});
	});
});
