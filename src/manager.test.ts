/* eslint-disable max-classes-per-file */
/* eslint-disable max-nested-callbacks */

import {describe, it} from 'node:test';
import {deepStrictEqual, ok, strictEqual} from 'node:assert';
import {createReadStream} from 'node:fs';
import {lstat, mkdir, rm, writeFile} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import {createHash} from 'node:crypto';
import {Server} from 'node:http';

import express from 'express';

import {IPackageDownloadProgress, Manager} from './manager';

const withTemp = (i => async (func: (path: string) => Promise<unknown>) => {
	const path = `./spec/tmp/manager/${i++}`;
	await rm(path, {recursive: true, force: true});
	try {
		await func(path);
	} finally {
		await rm(path, {recursive: true, force: true});
	}
})(0);

const strReverse = (s: string) => s.split('').reverse().join('');

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
	// None currently.
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
		return err as unknown;
	}
	throw new Error('Failed to get error');
}

/**
 * Create an HTTP server on a random port for testing.
 *
 * @returns Server details.
 */
export async function createServer() {
	const protocol = 'http:';
	const hostname = '127.0.0.1';
	let error: unknown = null;

	const app = express();
	let host = '';

	const server = await new Promise<Server>((resolve, reject) => {
		let inited = false;
		app.on('error', err => {
			error = error || err;
			if (!inited) {
				inited = true;
				reject(err);
			}
		});
		const server = app.listen(0, () => {
			if (!inited) {
				inited = true;
				resolve(server);
			}
		});
	});

	const address = server.address();
	let port = null;
	if (typeof address === 'string') {
		port = Number(address.split('//')[1].split('/')[0].split(':').pop());
	} else if (address) {
		({port} = address);
	}
	if (!port) {
		throw new Error('Failed to get port');
	}
	host = `${hostname}:${port}`;
	const url = `${protocol}//${host}`;

	const close = async () => {
		await new Promise<void>(resolve => {
			server.closeIdleConnections();
			server.close(() => {
				resolve();
			});
		});
		if (error) {
			throw error;
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
 * Create an HTTP server on a random port for testing.
 *
 * @param packages Packages list to use.
 * @returns Server details.
 */
async function createServerManager(packages: string) {
	const server = await createServer();
	server.app.get('/packages.json', (req, res) => {
		const reqHost = req.headers.host || server.host;
		const data = JSON.parse(packages) as {packages: {source: string}[]};
		for (const pkg of data.packages || []) {
			pkg.source = `${server.protocol}//${reqHost}${pkg.source}`;
		}
		res.setHeader('Content-Type', 'application/json; charset=utf-8');
		res.end(JSON.stringify(data, null, '\t'));
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
	await pipeline(stream, hash);
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
	func: (Manager: typeof ManagerTest, path: string) => Promise<void>
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
			public get packagesUrl() {
				return packagesUrl;
			}
		}

		try {
			await withTemp(async path => {
				await func(ManagerTestLocal, path);
			});
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
	func: (manager: ManagerTest) => unknown
) {
	return managerTest(packages, async (ManagerTest, path) => {
		await func(new ManagerTest(path));
	});
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

	return () => {
		prevDownloadProgress = null;
		events.splice(0, events.length);
	};
}

void describe('manager', () => {
	void describe('Manager', () => {
		void describe('update', () => {
			void it(
				'loaded',
				managerTestOne(JSON.stringify(packages), async manager => {
					await manager.update();
					strictEqual(manager.loaded, true);
				})
			);

			void it(
				'load from disk',
				managerTest(
					JSON.stringify(packages),
					async (ManagerTest, path) => {
						const manager1 = new ManagerTest(path);
						strictEqual(manager1.loaded, false);
						await manager1.update();
						strictEqual(manager1.loaded, true);

						const manager2 = new ManagerTest(path);
						await manager2.load();
						strictEqual(manager2.loaded, true);
					}
				)
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
						mod.packages = mod.packages.filter(
							(p: {name: string}) => p.name !== packageMulti.name
						);

						await writePackage(manager, mod);

						const report = await manager.update();

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

						const report = await manager.update();

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

						const report = await manager.update();

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

						const report = await manager.update();

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

						const report = await manager.update();

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

						const report = await manager.update();

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
						const error = (await promiseError(
							manager.load()
						)) as Error;

						ok(!manager.loaded);
						strictEqual(
							error.message,
							'Invalid format version minor: 1.0'
						);
					})
				);
			});
		});

		void describe('packageItter', () => {
			void it(
				'return',
				managerTestOne(JSON.stringify(packages), async manager => {
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

					const listed = [];
					for await (const {name} of manager.packages()) {
						listed.push(name);
					}
					deepStrictEqual(listed, expected);
				})
			);
		});

		void describe('packageByName', () => {
			void it(
				'return',
				managerTestOne(JSON.stringify(packages), async manager => {
					await manager.update();

					strictEqual(
						await manager.packageByName(packageObsoleteA.name),
						null
					);

					ok(await manager.packageByName(packageSingle.name));
				})
			);
		});

		void describe('packageBySha256', () => {
			void it(
				'return',
				managerTestOne(JSON.stringify(packages), async manager => {
					await manager.update();

					strictEqual(
						await manager.packageBySha256(
							packageSingleMetaBad.sha256
						),
						null
					);

					ok(await manager.packageBySha256(packageSingle.sha256));
				})
			);
		});

		void describe('packageBySha1', () => {
			void it(
				'return',
				managerTestOne(JSON.stringify(packages), async manager => {
					await manager.update();

					strictEqual(
						await manager.packageBySha1(packageSingleMetaBad.sha1),
						null
					);

					ok(await manager.packageBySha1(packageSingle.sha1));
				})
			);
		});

		void describe('packageByMd5', () => {
			void it(
				'return',
				managerTestOne(JSON.stringify(packages), async manager => {
					await manager.update();

					strictEqual(
						await manager.packageByMd5(packageSingleMetaBad.md5),
						null
					);

					ok(await manager.packageByMd5(packageSingle.md5));
				})
			);
		});

		void describe('packageByUnique', () => {
			void it(
				'return',
				managerTestOne(JSON.stringify(packages), async manager => {
					await manager.update();

					strictEqual(
						await manager.packageByUnique(packageObsoleteA.name),
						null
					);
					strictEqual(
						await manager.packageByUnique(
							packageSingleMetaBad.sha256
						),
						null
					);
					strictEqual(
						await manager.packageByUnique(
							packageSingleMetaBad.sha1
						),
						null
					);
					strictEqual(
						await manager.packageByUnique(packageSingleMetaBad.md5),
						null
					);

					ok(await manager.packageByUnique(packageSingle.name));
					ok(await manager.packageByUnique(packageSingle.sha256));
					ok(await manager.packageByUnique(packageSingle.sha1));
					ok(await manager.packageByUnique(packageSingle.md5));
				})
			);
		});

		void describe('isObsolete', () => {
			void it(
				'return',
				managerTestOne(JSON.stringify(packages), async manager => {
					await manager.update();

					await managerEnsureDirs(manager, [
						[unknownDirEmpty],
						[packageSingle.name, manager.metaDir]
					]);
					await managerWritePackageMeta(
						manager,
						packageObsoleteA.name,
						packageObsoleteA
					);
					await managerWritePackageMeta(
						manager,
						packageObsoleteB.name,
						packageObsoleteB
					);

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
			void it(
				'return',
				managerTestOne(JSON.stringify(packages), async manager => {
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
			void it(
				'return',
				managerTestOne(JSON.stringify(packages), async manager => {
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
			void it(
				'return',
				managerTestOne(JSON.stringify(packages), async manager => {
					await manager.update();

					await managerEnsureDirs(manager, [
						[unknownDirEmpty],
						[packageSingle.name, manager.metaDir]
					]);
					await managerWritePackageMeta(
						manager,
						packageObsoleteA.name,
						packageObsoleteA
					);
					await managerWritePackageMeta(
						manager,
						packageObsoleteB.name,
						packageObsoleteB
					);

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
			void it(
				'files',
				managerTestOne(JSON.stringify(packages), async manager => {
					await manager.update();

					await managerEnsureDirs(manager, [[unknownDirEmpty]]);
					await managerWritePackageMeta(
						manager,
						packageObsoleteA.name,
						packageObsoleteA
					);
					await managerWritePackageMeta(
						manager,
						packageObsoleteB.name,
						packageObsoleteB
					);
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
				managerTestOne(JSON.stringify(packages), async manager => {
					await manager.update();

					await managerEnsureDirs(manager, [[unknownDirEmpty]]);
					await managerWritePackageMeta(
						manager,
						packageObsoleteA.name,
						packageObsoleteA
					);
					await managerWritePackageMeta(
						manager,
						packageObsoleteB.name,
						packageObsoleteB
					);
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
				managerTestOne(JSON.stringify(packages), async manager => {
					await manager.update();

					await managerEnsureDirs(manager, [[unknownDirEmpty]]);
					await managerWritePackageMeta(
						manager,
						packageObsoleteA.name,
						packageObsoleteA
					);
					await managerWritePackageMeta(
						manager,
						packageObsoleteB.name,
						packageObsoleteB
					);
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
			void it(
				'files',
				managerTestOne(JSON.stringify(packages), async manager => {
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
				managerTestOne(JSON.stringify(packages), async manager => {
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

		void describe('install', () => {
			void describe('nested level: 0', () => {
				void it(
					'files',
					managerTestOne(JSON.stringify(packages), async manager => {
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
					})
				);

				void it(
					'return',
					managerTestOne(JSON.stringify(packages), async manager => {
						await manager.update();

						const a = await manager.install(packageSingle.name);
						const b = await manager.install(packageSingle.name);

						const aValues = a.map(p => p.name);
						deepStrictEqual(aValues, [packageSingle.name]);
						deepStrictEqual(b, []);
					})
				);

				void it(
					'events',
					managerTestOne(JSON.stringify(packages), async manager => {
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
					})
				);
			});

			void describe('nested level: 1', () => {
				void it(
					'files',
					managerTestOne(JSON.stringify(packages), async manager => {
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
					})
				);

				void it(
					'return',
					managerTestOne(JSON.stringify(packages), async manager => {
						await manager.update();

						const a = await manager.install(packageNested1.name);
						const b = await manager.install(packageNested1.name);

						const aValues = a.map(p => p.name);
						deepStrictEqual(aValues, [
							packageNested2.name,
							packageNested1.name
						]);
						deepStrictEqual(b, []);
					})
				);

				void it(
					'events',
					managerTestOne(JSON.stringify(packages), async manager => {
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
					})
				);
			});

			void describe('nested level: 2', () => {
				void it(
					'files',
					managerTestOne(JSON.stringify(packages), async manager => {
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
					})
				);

				void it(
					'return',
					managerTestOne(JSON.stringify(packages), async manager => {
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
					})
				);

				void it(
					'events',
					managerTestOne(JSON.stringify(packages), async manager => {
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
					})
				);
			});

			void describe('reuse closest: 1', () => {
				void it(
					'events',
					managerTestOne(JSON.stringify(packages), async manager => {
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
					})
				);
			});

			void describe('reuse closest: 2', () => {
				void it(
					'events',
					managerTestOne(JSON.stringify(packages), async manager => {
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
					})
				);
			});

			void describe('reuse closest: 2, outdated 1', () => {
				void it(
					'events',
					managerTestOne(JSON.stringify(packages), async manager => {
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

						deepStrictEqual(
							(await manager.outdated()).map(p => p.name),
							['package-nested-1']
						);
					})
				);
			});
		});

		void describe('outdated', () => {
			void it(
				'return',
				managerTestOne(JSON.stringify(packages), async manager => {
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
			void it(
				'files',
				managerTestOne(JSON.stringify(packages), async manager => {
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
				managerTestOne(JSON.stringify(packages), async manager => {
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
				managerTestOne(JSON.stringify(packages), async manager => {
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
			void it(
				'return',
				managerTestOne(JSON.stringify(packages), async manager => {
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
			void it(
				'return',
				managerTestOne(JSON.stringify(packages), async manager => {
					await manager.update();

					await manager.install(packageSingle.name);

					await managerWritePackageMeta(
						manager,
						packageNested1MetaBad.name,
						packageNested1MetaBad
					);

					const receipt = await manager.receipt(packageSingle.name);

					const receiptBad = await manager.receipt(
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

		void describe('file', () => {
			void it(
				'return',
				managerTestOne(JSON.stringify(packages), async manager => {
					await manager.update();

					await manager.install(packageSingle.name);

					await managerWritePackageMeta(
						manager,
						packageNested1MetaBad.name,
						packageNested1MetaBad
					);

					const filePath = await manager.file(packageSingle.name);
					const filePathExpected = await manager.pathToPackage(
						packageSingle.name,
						packageSingle.file
					);

					const filePathBad = await manager.file(
						packageNested1MetaBad.name
					);
					const filePathBadExpected = await manager.pathToPackage(
						packageNested1MetaBad.name,
						packageNested1MetaBad.file
					);

					strictEqual(filePath, filePathExpected);

					strictEqual(filePathBad, filePathBadExpected);
				})
			);

			void it(
				'installed',
				managerTestOne(JSON.stringify(packages), async manager => {
					await manager.update();

					await manager.install(packageSingle.name);

					await manager.packageInstallVerify(packageSingle.name);

					strictEqual(true, true);
				})
			);

			void it(
				'not installed',
				managerTestOne(JSON.stringify(packages), async manager => {
					await manager.update();

					const error = await promiseError(
						manager.packageInstallVerify(packageSingle.name)
					);

					ok(error);
					strictEqual(
						(error as Error).message,
						`Package is not installed: ${packageSingle.name}`
					);
				})
			);

			void it(
				'bad size',
				managerTestOne(JSON.stringify(packages), async manager => {
					await manager.update();

					await manager.install(packageSingle.name);

					const file = await manager.file(packageSingle.name);
					const size = packageSingle.size + 1;
					const data = Buffer.alloc(size);
					await writeFile(file, data);

					const error = await promiseError(
						manager.packageInstallVerify(packageSingle.name)
					);

					strictEqual(
						(error as Error).message,
						`Invalid file size: ${size}`
					);
				})
			);

			void it(
				'bad sha256',
				managerTestOne(JSON.stringify(packages), async manager => {
					await manager.update();

					await manager.install(packageSingle.name);

					const file = await manager.file(packageSingle.name);
					const {size} = packageSingle;
					const data = Buffer.alloc(size);
					const hash = sha256Buffer(data);
					await writeFile(file, data);

					const error = await promiseError(
						manager.packageInstallVerify(packageSingle.name)
					);

					ok(error);
					strictEqual(
						(error as Error).message,
						`Invalid sha256 hash: ${hash}`
					);
				})
			);
		});
	});
});
