import {createReadStream} from 'node:fs';
import {
	access,
	lstat,
	mkdir,
	open,
	readdir,
	readFile,
	rename,
	rm,
	writeFile
} from 'node:fs/promises';
import {join as pathJoin} from 'node:path';
import {Readable, Transform} from 'node:stream';
import {ReadableStream} from 'node:stream/web';
import {pipeline} from 'node:stream/promises';
import {createHash} from 'node:crypto';

import {
	MAIN_DIR,
	META_DIR,
	PACKAGE_FILE,
	PACKAGES_FILE,
	PACKAGES_URL,
	PACKAGES_URL_ENV,
	TEMP_EXT,
	PATH_ENV,
	TEMP_DIR
} from './constants';
import {Dispatcher} from './dispatcher';
import {EmptyStream, SliceStream, WriterStream} from './stream';
import {Package} from './package';
import {Packages} from './packages';
import {IFetch} from './types';
import {NAME, VERSION} from './meta';

export type PackageLike = Package | string;

export interface IPackageReceipt {
	//
	/**
	 * Package name.
	 */
	name: string;

	/**
	 * File name.
	 */
	file: string;

	/**
	 * File size.
	 */
	size: number;

	/**
	 * SHA256 hash of the file contents.
	 */
	sha256: string;

	/**
	 * Source, URL for root or file path for children.
	 */
	source: string;
}

export interface IPackageInstallBefore {
	//
	/**
	 * Package instance.
	 */
	package: Package;
}

export interface IPackageInstallAfter {
	//
	/**
	 * Package instance.
	 */
	package: Package;
}

export interface IPackageInstallCurrent {
	//
	/**
	 * Package instance.
	 */
	package: Package;
}

export interface IPackageDownloadBefore {
	//
	/**
	 * Package instance.
	 */
	package: Package;
}

export interface IPackageDownloadAfter {
	//
	/**
	 * Package instance.
	 */
	package: Package;
}

export interface IPackageDownloadProgress {
	//
	/**
	 * Package instance.
	 */
	package: Package;

	/**
	 * Progress total.
	 */
	total: number;

	/**
	 * Progress amount.
	 */
	amount: number;
}

export interface IPackageCleanupBefore {
	//
	/**
	 * Package name.
	 */
	package: string;
}

export interface IPackageCleanupAfter {
	//
	/**
	 * Package name.
	 */
	package: string;

	/**
	 * Package removed.
	 */
	removed: boolean;
}

export interface IPackageInstalled {
	//
	/**
	 * Package installed.
	 */
	package: Package;

	/**
	 * List of packages processed to complete the install.
	 */
	install: Package[];
}

export interface IPackageRemovedObsolete {
	//
	/**
	 * Package removed.
	 */
	package: string;

	/**
	 * Removed or already removed.
	 */
	removed: boolean;
}

/**
 * Package manager.
 */
export class Manager {
	/**
	 * The default headers for HTTP requests.
	 */
	public headers: {[header: string]: string} = {
		// eslint-disable-next-line @typescript-eslint/naming-convention
		'User-Agent': `${NAME}/${VERSION}`
	};

	/**
	 * A fetch-like interface requiring only a sebset of features.
	 */
	public fetch: IFetch | null =
		// @ts-expect-error Missing declaraion for fetch.
		typeof fetch === 'undefined' ? null : (fetch as IFetch);

	/**
	 * Package install before events.
	 */
	public readonly eventPackageInstallBefore =
		new Dispatcher<IPackageInstallBefore>(this);

	/**
	 * Package install after events.
	 */
	public readonly eventPackageInstallAfter =
		new Dispatcher<IPackageInstallAfter>(this);

	/**
	 * Package install current events.
	 */
	public readonly eventPackageInstallCurrent =
		new Dispatcher<IPackageInstallCurrent>(this);

	/**
	 * Package download before events.
	 */
	public readonly eventPackageDownloadBefore =
		new Dispatcher<IPackageDownloadBefore>(this);

	/**
	 * Package download after events.
	 */
	public readonly eventPackageDownloadAfter =
		new Dispatcher<IPackageDownloadAfter>(this);

	/**
	 * Package download progress events.
	 */
	public readonly eventPackageDownloadProgress =
		new Dispatcher<IPackageDownloadProgress>(this);

	/**
	 * Package cleanup before events.
	 */
	public readonly eventPackageCleanupBefore =
		new Dispatcher<IPackageCleanupBefore>(this);

	/**
	 * Package cleanup after events.
	 */
	public readonly eventPackageCleanupAfter =
		new Dispatcher<IPackageCleanupAfter>(this);

	/**
	 * Package list error events.
	 */
	public readonly eventPackageListError = new Dispatcher<Error>(this);

	/**
	 * Packages URL.
	 */
	protected readonly _packagesUrl: string = PACKAGES_URL;

	/**
	 * Packages file.
	 */
	protected readonly _packagesFile: string = PACKAGES_FILE;

	/**
	 * Package file.
	 */
	protected readonly _packageFile: string = PACKAGE_FILE;

	/**
	 * Main directory.
	 */
	protected readonly _mainDir: string = MAIN_DIR;

	/**
	 * Meta directory.
	 */
	protected readonly _metaDir: string = META_DIR;

	/**
	 * Path environment variable name.
	 */
	protected readonly _pathEnv: string = PATH_ENV;

	/**
	 * Packages URL environment variable name.
	 */
	protected readonly _packagesUrlEnv: string = PACKAGES_URL_ENV;

	/**
	 * Inited flag.
	 */
	protected _inited = false;

	/**
	 * Destroyed flag.
	 */
	protected _destroyed = false;

	/**
	 * Root path.
	 */
	protected readonly _path: string;

	/**
	 * Packages instance.
	 */
	protected readonly _packages: Packages;

	/**
	 * Manager constructor.
	 *
	 * @param path The path, defaults to environment variable or relative.
	 */
	constructor(path: string | null = null) {
		this._path = this._createPath(path);
		this._packagesUrl = this._createPackagesUrl(this._packagesUrl);
		this._packages = this._createPackages();
	}

	/**
	 * Root path.
	 *
	 * @returns The path.
	 */
	public get path() {
		return this._path;
	}

	/**
	 * Packages URL.
	 *
	 * @returns The URL.
	 */
	public get packagesUrl() {
		return this._packagesUrl;
	}

	/**
	 * Packages file.
	 *
	 * @returns The file.
	 */
	public get packagesFile() {
		return this._packagesFile;
	}

	/**
	 * Package file.
	 *
	 * @returns The path.
	 */
	public get packageFile() {
		return this._packageFile;
	}

	/**
	 * Packages file path.
	 *
	 * @returns The path.
	 */
	public get pathMetaPackages() {
		return this.pathToMeta(this.packagesFile);
	}

	/**
	 * Meta directory.
	 *
	 * @returns The directory.
	 */
	public get metaDir() {
		return this._metaDir;
	}

	/**
	 * Meta directory path for root path.
	 *
	 * @returns The path.
	 */
	public get pathMeta() {
		return this.pathToMeta();
	}

	/**
	 * Instance inited and not yet destroyed.
	 *
	 * @returns Is active.
	 */
	public get active() {
		return !this._destroyed && this._inited;
	}

	/**
	 * Packages loaded.
	 *
	 * @returns Is loaded.
	 */
	public get loaded() {
		return this._packages.loaded;
	}

	/**
	 * Assert instance not inited.
	 */
	public assertNotInited() {
		if (this._inited) {
			throw new Error('Instance initialized');
		}
	}

	/**
	 * Assert instance is active.
	 * Implies inited, not-destroyed, and lock-not-compromised assertions.
	 */
	public assertActive() {
		// Check everything is active in order they should report failure.
		this._assertInited();
		this._assertNotDestroyed();
	}

	/**
	 * Assert instance all loaded, including the packages list.
	 * Implies all active assertions.
	 */
	public assertLoaded() {
		this.assertActive();
		if (!this.loaded) {
			throw new Error('Packages list not loaded');
		}
	}

	/**
	 * Initialize instance.
	 */
	public async init() {
		this.assertNotInited();

		await this._ensureDirs();
		try {
			await this._packages.readIfExists();
		} catch (err) {
			this.eventPackageListError.trigger(err as Error);
		}

		this._inited = true;
		this._destroyed = false;
	}

	/**
	 * Destroy instance.
	 */
	// eslint-disable-next-line @typescript-eslint/require-await
	public async destroy() {
		// Destroy should always work only once if instance was inited.
		this._assertInited();
		this._assertNotDestroyed();

		this._destroyed = true;
		this._inited = false;
	}

	/**
	 * Run asyncronous function with automatic init and destroy.
	 *
	 * @param func Async function.
	 * @returns Return value of the async function.
	 */
	public async with<T>(func: (self: this) => T | Promise<T>): Promise<T> {
		await this.init();
		let r: T;
		try {
			r = (await func.call(this, this)) as T;
		} finally {
			await this.destroy();
		}
		return r;
	}

	/**
	 * Iterate over the packages.
	 *
	 * @yields Package object.
	 */
	public *packages() {
		this.assertActive();

		for (const entry of this._packages.packages()) {
			this.assertActive();
			yield entry;
		}
	}

	/**
	 * Get package by the unique name.
	 *
	 * @param name Package name.
	 * @returns The package or null.
	 */
	public packageByName(name: string) {
		this.assertLoaded();

		return this._packages.byName(name);
	}

	/**
	 * Get package by the sha256 hash.
	 *
	 * @param sha256 Package sha256.
	 * @returns The package or null.
	 */
	public packageBySha256(sha256: string) {
		this.assertLoaded();

		return this._packages.bySha256(sha256);
	}

	/**
	 * Get package by the sha1 hash.
	 *
	 * @param sha1 Package sha1.
	 * @returns The package or null.
	 */
	public packageBySha1(sha1: string) {
		this.assertLoaded();

		return this._packages.bySha1(sha1);
	}

	/**
	 * Get package by the md5 hash.
	 *
	 * @param md5 Package md5.
	 * @returns The package or null.
	 */
	public packageByMd5(md5: string) {
		this.assertLoaded();

		return this._packages.byMd5(md5);
	}

	/**
	 * Get package by the unique value.
	 *
	 * @param unique Package unique.
	 * @returns The package or null.
	 */
	public packageByUnique(unique: string) {
		this.assertLoaded();

		return this._packages.byUnique(unique);
	}

	/**
	 * Check if package is in packages collection.
	 *
	 * @param pkg Package instance.
	 * @returns If the package instance is present.
	 */
	public packageIsMember(pkg: Package) {
		this.assertLoaded();

		return this._packages.has(pkg);
	}

	/**
	 * Read package install receipt.
	 *
	 * @param pkg The package.
	 * @returns Install receipt.
	 */
	public async packageInstallReceipt(pkg: PackageLike) {
		this.assertLoaded();

		const name = this._asName(pkg);
		const pkgf = this.pathToPackageMeta(name, this.packageFile);

		const r = await readFile(pkgf, 'utf8')
			.then(s => JSON.parse(s) as IPackageReceipt)
			.catch(() => null);
		if (!r) {
			throw new Error(`Package is not installed: ${name}`);
		}
		return r;
	}

	/**
	 * Get package install file.
	 *
	 * @param pkg The package.
	 * @returns Path to install file.
	 */
	public async packageInstallFile(pkg: PackageLike) {
		this.assertLoaded();
		pkg = this._asPackage(pkg);

		const data = await this.packageInstallReceipt(pkg);
		return this.pathToPackage(pkg, data.file);
	}

	/**
	 * Verify package install file, using size and hash.
	 *
	 * @param pkg The package.
	 */
	public async packageInstallVerify(pkg: PackageLike) {
		this.assertLoaded();
		pkg = this._asPackage(pkg);

		const data = await this.packageInstallReceipt(pkg);
		const {sha256, file, size} = data;
		const filePath = this.pathToPackage(pkg, file);

		const stat = await lstat(filePath);
		const fSize = stat.size;
		if (fSize !== size) {
			throw new Error(`Invalid file size: ${fSize}`);
		}

		const stream = createReadStream(filePath);
		let hashsum = '';
		const hash = createHash('sha256');
		hash.setEncoding('hex');
		hash.on('finish', () => {
			hashsum = hash.read() as string;
		});
		await pipeline(stream, hash);

		if (hashsum !== sha256) {
			throw new Error(`Invalid sha256 hash: ${hashsum}`);
		}
	}

	/**
	 * Update the package manager installed data.
	 * Updates the packages list.
	 *
	 * @returns Update report.
	 */
	public async update() {
		this.assertActive();

		return this._updatePackages();
	}

	/**
	 * Check if a package is installed.
	 *
	 * @param pkg The package.
	 * @returns True if already installed, else false.
	 */
	public async isInstalled(pkg: PackageLike) {
		this.assertLoaded();
		pkg = this._asPackage(pkg);

		try {
			await this.packageInstallReceipt(pkg);
		} catch (err) {
			return false;
		}
		return true;
	}

	/**
	 * Check if a package is installed and up-to-date.
	 *
	 * @param pkg The package.
	 * @returns True if already up-to-date, else false.
	 */
	public async isCurrent(pkg: PackageLike) {
		this.assertLoaded();
		pkg = this._asPackage(pkg);

		let data: IPackageReceipt | null = null;
		try {
			data = await this.packageInstallReceipt(pkg);
		} catch (err) {
			return false;
		}
		return !!(
			data.sha256 === pkg.sha256 &&
			data.size === pkg.size &&
			data.file === pkg.file &&
			data.name === pkg.name
		);
	}

	/**
	 * List all installed packages.
	 *
	 * @returns A list of installed package objects.
	 */
	public async installed() {
		this.assertLoaded();

		const list: Package[] = [];
		for (const entry of await this._packageDirectories()) {
			const pkg = this.packageByName(entry);
			// eslint-disable-next-line no-await-in-loop
			if (pkg && (await this.isInstalled(pkg))) {
				list.push(pkg);
			}
		}
		return list;
	}

	/**
	 * List all outdated packages.
	 *
	 * @returns The list of outdated package objects.
	 */
	public async outdated() {
		this.assertLoaded();

		const list: Package[] = [];
		for (const entry of await this._packageDirectories()) {
			const pkg = this.packageByName(entry);
			// eslint-disable-next-line no-await-in-loop
			if (pkg && !(await this.isCurrent(pkg))) {
				list.push(pkg);
			}
		}
		return list;
	}

	/**
	 * Upgrade any outdated packages.
	 *
	 * @returns List of packages upgraded.
	 */
	public async upgrade() {
		this.assertLoaded();

		const outdated = await this.outdated();
		const list: IPackageInstalled[] = [];
		for (const pkg of outdated) {
			list.push({
				package: pkg,
				// eslint-disable-next-line no-await-in-loop
				install: await this.install(pkg)
			});
		}
		return list;
	}

	/**
	 * Install package.
	 * Returns the list of packages processed to install.
	 * Returns empty array if current version is already installed.
	 *
	 * @param pkg The package.
	 * @returns List of packages processed to complete the install.
	 */
	public async install(pkg: PackageLike) {
		this.assertLoaded();
		const pkgO = (pkg = this._asPackage(pkg));
		const fetch = this._assertFetch();

		// If current version is installed, skip.
		const installed = await this.isCurrent(pkg);
		if (installed) {
			this.eventPackageInstallCurrent.trigger({
				package: pkg
			});
			return [];
		}

		// Find the closest current installed parent, if any.
		const packages: Package[] = [pkg];
		for (let p = pkg.parent; p; p = p.parent) {
			packages.push(p);
		}
		packages.reverse();
		const [srcPkg] = packages;

		// Find the lowest slice to read before compression.
		// Build transforms to pipe the source slice through.
		let slice: [number, number] | null = null;
		const transforms: Transform[] = [];
		{
			let i = 1;
			while (i < packages.length) {
				const p = packages[i++];
				const [ss, sl] = p.getZippedSlice();
				if (slice) {
					slice[0] += ss;
					slice[1] = sl;
				} else {
					slice = [ss, sl];
				}
				const d = p.getZippedDecompressor();
				if (d) {
					transforms.push(d);
					break;
				}
			}
			while (i < packages.length) {
				const p = packages[i++];
				const [ss, sl] = p.getZippedSlice();
				transforms.push(new SliceStream(ss, sl));
				const d = p.getZippedDecompressor();
				if (d) {
					transforms.push(d);
				}
			}
		}

		this.eventPackageInstallBefore.trigger({
			package: pkg
		});

		const outFile = this.pathToPackage(pkg, pkg.file);
		const tmpDir = this.pathToPackageMeta(pkg, TEMP_DIR);
		const tmpFile = pathJoin(tmpDir, `${pkg.sha256}${TEMP_EXT}`);
		const metaFile = this.pathToPackageMeta(pkg, this.packageFile);

		// Create temporary directory, cleanup on failure.
		await rm(tmpDir, {recursive: true, force: true});
		await mkdir(tmpDir, {recursive: true});
		const fd = await open(tmpFile, 'wx');
		try {
			const output = new WriterStream(tmpFile, {
				fd
			});

			this.eventPackageDownloadBefore.trigger({
				package: pkgO
			});

			this.eventPackageDownloadProgress.trigger({
				package: pkgO,
				total: pkgO.size,
				amount: 0
			});

			// Create output file, monitoring write progress.
			output.on('wrote', () => {
				this.eventPackageDownloadProgress.trigger({
					package: pkgO,
					total: pkgO.size,
					amount: output.bytesWritten
				});
			});

			let input: NodeJS.ReadableStream;
			const url = srcPkg.source;
			if (slice) {
				const [start, size] = slice;
				if (size > 0) {
					const response = await fetch(url, {
						headers: {
							...this.headers,
							Range: `bytes=${start}-${start + size - 1}`
						}
					});
					const {status} = response;
					if (status !== 206) {
						throw new Error(
							`Invalid resume status: ${status}: ${url}`
						);
					}
					const cl = response.headers.get('content-length');
					if (cl && +cl !== size) {
						throw new Error(
							`Invalid resume content-length: ${cl}: ${url}`
						);
					}
					const {body} = response;
					try {
						input = Readable.fromWeb(body as ReadableStream);
					} catch (err) {
						input = body as NodeJS.ReadableStream;
					}
				} else if (size === 0) {
					input = new EmptyStream();
				} else {
					throw new Error(`Cannot download negative size: ${size}`);
				}
			} else {
				const response = await fetch(url, {
					headers: this.headers
				});
				const {status} = response;
				if (status !== 200) {
					throw new Error(
						`Invalid download status: ${status}: ${url}`
					);
				}
				const cl = response.headers.get('content-length');
				if (cl && +cl !== srcPkg.size) {
					throw new Error(
						`Invalid download content-length: ${cl}: ${url}`
					);
				}
				const {body} = response;
				try {
					input = Readable.fromWeb(body as ReadableStream);
				} catch (err) {
					input = body as NodeJS.ReadableStream;
				}
			}

			// Hash the last readable stream to verify package.
			const hash = createHash('sha256');
			const lastData = transforms.length
				? transforms[transforms.length - 1]
				: input;
			lastData.on('data', (data: Buffer) => {
				hash.update(data);
			});

			// Pipe all the streams through the pipeline.
			// Work around types failing on variable args.
			await (pipeline as (...args: unknown[]) => Promise<void>)(
				input,
				...transforms,
				output
			);

			// Verify the write size.
			if (output.bytesWritten !== pkg.size) {
				throw new Error(`Invalid extract size: ${output.bytesWritten}`);
			}

			// Verify the file hash.
			const hashed = hash.digest().toString('hex');
			if (hashed !== pkg.sha256) {
				throw new Error(`Invalid sha256 hash: ${hashed}`);
			}

			this.eventPackageDownloadAfter.trigger({
				package: pkgO
			});

			// Move the final file into place and write package file.
			// Write the package receipt last, means successful install.
			await this._packageDirsEnsure(pkg);
			await rm(metaFile, {force: true});
			await rm(outFile, {force: true});
			await rename(tmpFile, outFile);
			await this._packageMetaReceiptWrite(pkg);
		} finally {
			// Should normally closed when stream ends.
			await fd.close();
			await rm(tmpDir, {recursive: true, force: true});
		}

		this.eventPackageInstallAfter.trigger({
			package: pkg
		});

		return packages;
	}

	/**
	 * Remove package.
	 *
	 * @param pkg The package.
	 * @returns True if removed, false if nothing to remove.
	 */
	public async remove(pkg: PackageLike) {
		this.assertLoaded();

		const dir = this.pathToPackage(pkg);
		const stat = await lstat(dir).catch(() => null);
		if (!stat) {
			return false;
		}
		const dirMeta = this.pathToPackageMeta(pkg);

		// Remove meta directory first, avoid partial installed state.
		await rm(dirMeta, {recursive: true, force: true});
		await rm(dir, {recursive: true, force: true});
		return true;
	}

	/**
	 * Check if package name is obsolete.
	 *
	 * @param pkg The package.
	 * @returns True if package obslete, else false.
	 */
	public async isObsolete(pkg: string) {
		this.assertLoaded();

		return (
			!pkg.startsWith('.') &&
			!this.packageByName(pkg) &&
			access(this.pathToPackageMeta(pkg)).then(
				() => true,
				() => false
			)
		);
	}

	/**
	 * List obsolete package names.
	 *
	 * @returns A list of obsolete package names.
	 */
	public async obsolete() {
		this.assertLoaded();

		const list: string[] = [];
		for (const entry of await this._packageDirectories()) {
			// eslint-disable-next-line no-await-in-loop
			if (await this.isObsolete(entry)) {
				list.push(entry);
			}
		}
		return list;
	}

	/**
	 * Cleanup all obsolete and outdated packages.
	 *
	 * @returns Lists of removed packages.
	 */
	public async cleanup() {
		this.assertLoaded();

		const list: IPackageRemovedObsolete[] = [];
		for (const pkg of await this._packageDirectories()) {
			// Remove any temporary directory if present.
			const tmpDir = this.pathToPackageMeta(pkg, TEMP_DIR);
			// eslint-disable-next-line no-await-in-loop
			await rm(tmpDir, {recursive: true, force: true});

			// eslint-disable-next-line no-await-in-loop
			if (await this.isObsolete(pkg)) {
				this.eventPackageCleanupBefore.trigger({
					package: pkg
				});

				// eslint-disable-next-line no-await-in-loop
				const removed = await this.remove(pkg);

				this.eventPackageCleanupAfter.trigger({
					package: pkg,
					removed
				});
				list.push({
					package: pkg,
					removed
				});
			}
		}
		return list;
	}

	/**
	 * Join path on the base path.
	 *
	 * @param parts Path parts.
	 * @returns Joined path.
	 */
	public pathTo(...parts: string[]) {
		return pathJoin(this.path, ...parts);
	}

	/**
	 * Join path on the meta path.
	 *
	 * @param parts Path parts.
	 * @returns Joined path.
	 */
	public pathToMeta(...parts: string[]) {
		return this.pathTo(this.metaDir, ...parts);
	}

	/**
	 * Join path on package base path.
	 *
	 * @param pkg The package.
	 * @param parts Path parts.
	 * @returns Joined path.
	 */
	public pathToPackage(pkg: PackageLike, ...parts: string[]) {
		this.assertActive();

		return this.pathTo(this._asName(pkg), ...parts);
	}

	/**
	 * Join path on package meta path.
	 *
	 * @param pkg The package.
	 * @param parts Path parts.
	 * @returns Joined path.
	 */
	public pathToPackageMeta(pkg: PackageLike, ...parts: string[]) {
		this.assertActive();

		return this.pathTo(this._asName(pkg), this.metaDir, ...parts);
	}

	/**
	 * Get package object by object, name, or hash.
	 * Throw error if package is unknown.
	 *
	 * @param pkg The package.
	 * @returns Package object.
	 */
	protected _asPackage(pkg: PackageLike) {
		this.assertLoaded();

		if (typeof pkg === 'string') {
			const p = this.packageByUnique(pkg);
			if (!p) {
				throw new Error(`Unknown package: ${pkg}`);
			}
			return p;
		}
		return pkg;
	}

	/**
	 * Get package name by object, name, or hash.
	 * If package object is passed, uses name from the object.
	 * If string is passed and unknown, returns that same string.
	 *
	 * @param pkg The package.
	 * @returns Package object.
	 */
	protected _asName(pkg: PackageLike) {
		this.assertLoaded();

		return typeof pkg === 'string'
			? this.packageByUnique(pkg)?.name ?? pkg
			: pkg.name;
	}

	/**
	 * Write package installed receipt.
	 *
	 * @param pkg The package.
	 */
	protected async _packageMetaReceiptWrite(pkg: PackageLike) {
		this.assertLoaded();
		pkg = this._asPackage(pkg);

		const pkgf = this.pathToPackageMeta(pkg, this.packageFile);
		const pkgfTmp = `${pkgf}${TEMP_EXT}`;

		const receipt = await this._packageMetaReceiptFromPackage(pkg);
		await rm(pkgfTmp, {force: true});
		await writeFile(pkgfTmp, JSON.stringify(receipt, null, '\t'), {
			flag: 'wx'
		});
		await rename(pkgfTmp, pkgf);
	}

	/**
	 * Create package installed receipt object from a package.
	 *
	 * @param pkg The package.
	 * @returns Receipt object.
	 */
	// eslint-disable-next-line @typescript-eslint/require-await
	protected async _packageMetaReceiptFromPackage(pkg: PackageLike) {
		this.assertLoaded();
		pkg = this._asPackage(pkg);

		const r: IPackageReceipt = {
			name: pkg.name,
			file: pkg.file,
			size: pkg.size,
			sha256: pkg.sha256,
			source: pkg.source
		};
		return r;
	}

	/**
	 * Ensure package directory exists.
	 *
	 * @param pkg The package.
	 */
	protected async _packageDirsEnsure(pkg: PackageLike) {
		this.assertLoaded();
		pkg = this._asPackage(pkg);

		const dir = this.pathToPackage(pkg);
		const dirMeta = this.pathToPackageMeta(pkg);
		await mkdir(dir, {recursive: true});
		await mkdir(dirMeta, {recursive: true});
	}

	/**
	 * Assert instance is inited.
	 */
	protected _assertInited() {
		if (!this._inited) {
			throw new Error('Instance uninitialized');
		}
	}

	/**
	 * Assert instance not destroyed.
	 */
	protected _assertNotDestroyed() {
		if (this._destroyed) {
			throw new Error('Instance destroyed');
		}
	}

	/**
	 * Assert the package is in packages collection.
	 *
	 * @param pkg Package instance.
	 */
	protected _assertpackageIsMember(pkg: Package) {
		this.assertLoaded();

		this._packages.assertHas(pkg);
	}

	/**
	 * Assert and get fetch-like function if set.
	 *
	 * @returns The fetch-like function.
	 */
	protected _assertFetch(): IFetch {
		const {fetch} = this;
		if (!fetch) {
			throw new Error('Default fetch not available');
		}
		return fetch;
	}

	/**
	 * List directories under package manger control.
	 *
	 * @returns The recognized package directories.
	 */
	protected async _packageDirectories() {
		this.assertLoaded();

		return (await readdir(this.path, {withFileTypes: true}))
			.filter(e => !e.name.startsWith('.') && e.isDirectory())
			.map(e => e.name)
			.sort();
	}

	/**
	 * Request the packages file.
	 *
	 * @returns File contents as string.
	 */
	protected async _requestPackages() {
		this.assertActive();
		const fetch = this._assertFetch();

		const url = this.packagesUrl;
		const response = await fetch(url, {
			headers: {
				...this.headers,
				// eslint-disable-next-line @typescript-eslint/naming-convention
				'Cache-Control': 'max-age=0',
				Pragma: 'no-cache'
			}
		});
		const {status} = response;
		if (status !== 200) {
			throw new Error(`Invalid response status: ${status}: ${url}`);
		}
		return response.text();
	}

	/**
	 * Update the packages list.
	 *
	 * @returns Update report.
	 */
	protected async _updatePackages() {
		this.assertActive();

		// Read data, update list, write list to file, return report.
		const data = await this._requestPackages();
		const report = this._packages.update(data);
		await this._packages.write();
		return report;
	}

	/**
	 * Ensure base directories exists.
	 */
	protected async _ensureDirs() {
		await mkdir(this.path, {recursive: true});
		await mkdir(this.pathMeta, {recursive: true});
	}

	/**
	 * Create the main path.
	 *
	 * @param path The path, defaults to environment variable or relative.
	 * @returns Main path.
	 */
	protected _createPath(path: string | null) {
		// Use specified, or environment variable, or relative default.
		// eslint-disable-next-line no-process-env
		return path || process.env[this._pathEnv] || this._mainDir;
	}

	/**
	 * Create the packages URL.
	 *
	 * @param defaultUrl The default URL if the environment variable not set.
	 * @returns Packages URL.
	 */
	protected _createPackagesUrl(defaultUrl: string) {
		// eslint-disable-next-line no-process-env
		return process.env[this._packagesUrlEnv] || defaultUrl;
	}

	/**
	 * Create the Packages instance.
	 *
	 * @returns Packages instance.
	 */
	protected _createPackages() {
		return new Packages(this.pathMetaPackages);
	}
}
