import {createReadStream} from 'node:fs';
import {
	access,
	lstat,
	mkdir,
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
	PART_EXT,
	PATH_ENV,
	TEMP_DIR
} from './constants';
import {Dispatcher} from './dispatcher';
import {EmptyStream, SliceStream, WriterStream} from './stream';
import {Package} from './package';
import {Packages} from './packages';
import {
	IFetch,
	IPackageCleanupAfter,
	IPackageCleanupBefore,
	IPackageDownloadAfter,
	IPackageDownloadBefore,
	IPackageDownloadProgress,
	IPackageInstallAfter,
	IPackageInstallBefore,
	IPackageInstallCurrent,
	IPackageInstalled,
	IPackageReceipt,
	IPackageRemovedObsolete,
	PackageLike
} from './types';
import {NAME, VERSION} from './meta';

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
	 * Exclusive access flag.
	 */
	protected _exclusive = false;

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
		// eslint-disable-next-line no-sync
		this._exclusiveSync(() => {
			this._assertNotInited();
		});
	}

	/**
	 * Assert instance is active.
	 * Implies inited, not-destroyed, and lock-not-compromised assertions.
	 */
	public assertActive() {
		// eslint-disable-next-line no-sync
		this._exclusiveSync(() => {
			this._assertActive();
		});
	}

	/**
	 * Assert instance all loaded, including the packages list.
	 * Implies all active assertions.
	 */
	public assertLoaded() {
		// eslint-disable-next-line no-sync
		this._exclusiveSync(() => {
			this._assertLoaded();
		});
	}

	/**
	 * Initialize instance.
	 */
	public async init() {
		await this._exclusiveAsync(async () => this._init());
	}

	/**
	 * Destroy instance.
	 */
	public async destroy() {
		await this._exclusiveAsync(async () => this._destroy());
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
	 * Itterate over the packages.
	 *
	 * @returns Package itterator.
	 */
	public packageItter() {
		// eslint-disable-next-line no-sync
		return this._exclusiveSync(() => this._packageItter());
	}

	/**
	 * Get package by the unique name.
	 *
	 * @param name Package name.
	 * @returns The package or null.
	 */
	public packageByName(name: string) {
		// eslint-disable-next-line no-sync
		return this._exclusiveSync(() => this._packageByName(name));
	}

	/**
	 * Get package by the sha256 hash.
	 *
	 * @param sha256 Package sha256.
	 * @returns The package or null.
	 */
	public packageBySha256(sha256: string) {
		// eslint-disable-next-line no-sync
		return this._exclusiveSync(() => this._packageBySha256(sha256));
	}

	/**
	 * Get package by the sha1 hash.
	 *
	 * @param sha1 Package sha1.
	 * @returns The package or null.
	 */
	public packageBySha1(sha1: string) {
		// eslint-disable-next-line no-sync
		return this._exclusiveSync(() => this._packageBySha1(sha1));
	}

	/**
	 * Get package by the md5 hash.
	 *
	 * @param md5 Package md5.
	 * @returns The package or null.
	 */
	public packageByMd5(md5: string) {
		// eslint-disable-next-line no-sync
		return this._exclusiveSync(() => this._packageByMd5(md5));
	}

	/**
	 * Get package by the unique value.
	 *
	 * @param unique Package unique.
	 * @returns The package or null.
	 */
	public packageByUnique(unique: string) {
		// eslint-disable-next-line no-sync
		return this._exclusiveSync(() => this._packageByUnique(unique));
	}

	/**
	 * Check if package is in packages collection.
	 *
	 * @param pkg Package instance.
	 * @returns If the package instance is present.
	 */
	public packageIsMember(pkg: Package) {
		// eslint-disable-next-line no-sync
		return this._exclusiveSync(() => this._packageIsMember(pkg));
	}

	/**
	 * Read package install receipt.
	 *
	 * @param pkg The package.
	 * @returns Install receipt.
	 */
	public async packageInstallReceipt(pkg: PackageLike) {
		return this._exclusiveAsync(async () =>
			this._packageMetaReceiptRead(pkg)
		);
	}

	/**
	 * Get package install file.
	 *
	 * @param pkg The package.
	 * @returns Path to install file.
	 */
	public async packageInstallFile(pkg: PackageLike) {
		return this._exclusiveAsync(async () => this._packageInstallFile(pkg));
	}

	/**
	 * Verify package install file, using size and hash.
	 *
	 * @param pkg The package.
	 */
	public async packageInstallVerify(pkg: PackageLike) {
		await this._exclusiveAsync(async () => this._packageInstallVerify(pkg));
	}

	/**
	 * Update the package manager installed data.
	 * Updates the packages list.
	 *
	 * @returns Update report.
	 */
	public async update() {
		return this._exclusiveAsync(async () => this._update());
	}

	/**
	 * Check if a package is installed.
	 *
	 * @param pkg The package.
	 * @returns True if already installed, else false.
	 */
	public async isInstalled(pkg: PackageLike) {
		return this._exclusiveAsync(async () => this._isInstalled(pkg));
	}

	/**
	 * Check if a package is installed and up-to-date.
	 *
	 * @param pkg The package.
	 * @returns True if already up-to-date, else false.
	 */
	public async isCurrent(pkg: PackageLike) {
		return this._exclusiveAsync(async () => this._isCurrent(pkg));
	}

	/**
	 * List all installed packages.
	 *
	 * @returns A list of installed package objects.
	 */
	public async installed() {
		return this._exclusiveAsync(async () => this._installed());
	}

	/**
	 * List all outdated packages.
	 *
	 * @returns The list of outdated package objects.
	 */
	public async outdated() {
		return this._exclusiveAsync(async () => this._outdated());
	}

	/**
	 * Upgrade any outdated packages.
	 *
	 * @returns List of packages upgraded.
	 */
	public async upgrade() {
		return this._exclusiveAsync(async () => this._upgrade());
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
		return this._exclusiveAsync(async () => this._install(pkg));
	}

	/**
	 * Remove package.
	 *
	 * @param pkg The package.
	 * @returns True if removed, false if nothing to remove.
	 */
	public async remove(pkg: PackageLike) {
		return this._exclusiveAsync(async () => this._remove(pkg));
	}

	/**
	 * Check if package name is obsolete.
	 *
	 * @param pkg The package.
	 * @returns True if package obslete, else false.
	 */
	public async isObsolete(pkg: string) {
		return this._exclusiveAsync(async () => this._isObsolete(pkg));
	}

	/**
	 * List obsolete package names.
	 *
	 * @returns A list of obsolete package names.
	 */
	public async obsolete() {
		return this._exclusiveAsync(async () => this._obsolete());
	}

	/**
	 * Cleanup all obsolete and outdated packages.
	 *
	 * @returns Lists of removed packages.
	 */
	public async cleanup() {
		return this._exclusiveAsync(async () => this._cleanup());
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
		// eslint-disable-next-line no-sync
		return this._exclusiveSync(() => this._pathToPackage(pkg, ...parts));
	}

	/**
	 * Join path on package meta path.
	 *
	 * @param pkg The package.
	 * @param parts Path parts.
	 * @returns Joined path.
	 */
	public pathToPackageMeta(pkg: PackageLike, ...parts: string[]) {
		// eslint-disable-next-line no-sync
		return this._exclusiveSync(() =>
			this._pathToPackageMeta(pkg, ...parts)
		);
	}

	/**
	 * Join path on package base path.
	 *
	 * @param pkg The package.
	 * @param parts Path parts.
	 * @returns Joined path.
	 */
	protected _pathToPackage(pkg: PackageLike, ...parts: string[]) {
		this._assertActive();

		const name = this._packageToName(pkg, false);
		return this.pathTo(name, ...parts);
	}

	/**
	 * Join path on package meta path.
	 *
	 * @param pkg The package.
	 * @param parts Path parts.
	 * @returns Joined path.
	 */
	protected _pathToPackageMeta(pkg: PackageLike, ...parts: string[]) {
		this._assertActive();

		const name = this._packageToName(pkg, false);
		return this.pathTo(name, this.metaDir, ...parts);
	}

	/**
	 * Obtain exclusive access for the duration of a syncronous callback.
	 *
	 * @param func Syncronous function.
	 * @returns Return value of the syncronous callback.
	 */
	protected _exclusiveSync<T>(func: (self: this) => T): T {
		this._assertNotExclusive();

		this._exclusive = true;
		let r: T;
		try {
			r = func.call(this, this) as T;
		} finally {
			this._exclusive = false;
		}
		return r;
	}

	/**
	 * Obtain exclusive access for the duration of a asyncronous callback.
	 *
	 * @param func Asyncronous function.
	 * @returns Return value of the asyncronous callback.
	 */
	protected async _exclusiveAsync<T>(
		func: (self: this) => Promise<T>
	): Promise<T> {
		this._assertNotExclusive();

		this._exclusive = true;
		let r: T;
		try {
			r = (await func.call(this, this)) as T;
		} finally {
			this._exclusive = false;
		}
		return r;
	}

	/**
	 * Itterate over the packages.
	 *
	 * @yields Package object.
	 */
	protected *_packageItter() {
		this._assertActive();

		for (const entry of this._packages.itter()) {
			this._assertActive();
			yield entry;
		}
	}

	/**
	 * Get package by the unique name.
	 *
	 * @param name Package name.
	 * @returns The package or null.
	 */
	protected _packageByName(name: string) {
		this._assertLoaded();

		return this._packages.byName(name);
	}

	/**
	 * Get package by the sha256 hash.
	 *
	 * @param sha256 Package sha256.
	 * @returns The package or null.
	 */
	protected _packageBySha256(sha256: string) {
		this._assertLoaded();

		return this._packages.bySha256(sha256);
	}

	/**
	 * Get package by the sha1 hash.
	 *
	 * @param sha1 Package sha1.
	 * @returns The package or null.
	 */
	protected _packageBySha1(sha1: string) {
		this._assertLoaded();

		return this._packages.bySha1(sha1);
	}

	/**
	 * Get package by the md5 hash.
	 *
	 * @param md5 Package md5.
	 * @returns The package or null.
	 */
	protected _packageByMd5(md5: string) {
		this._assertLoaded();

		return this._packages.byMd5(md5);
	}

	/**
	 * Get package by the unique value.
	 *
	 * @param unique Package unique.
	 * @returns The package or null.
	 */
	protected _packageByUnique(unique: string) {
		this._assertLoaded();

		return this._packages.byUnique(unique);
	}

	/**
	 * Check if package is in packages collection.
	 *
	 * @param pkg Package instance.
	 * @returns If the package instance is present.
	 */
	protected _packageIsMember(pkg: Package) {
		this._assertLoaded();

		return this._packages.has(pkg);
	}

	/**
	 * Get package install file.
	 *
	 * @param pkg The package.
	 * @returns Path to install file.
	 */
	protected async _packageInstallFile(pkg: PackageLike) {
		this._assertLoaded();
		pkg = this._packageToPackage(pkg);

		const data = await this._packageMetaReceiptRead(pkg);
		return this._pathToPackage(pkg, data.file);
	}

	/**
	 * Verify package install file, using size and hash.
	 *
	 * @param pkg The package.
	 */
	protected async _packageInstallVerify(pkg: PackageLike) {
		this._assertLoaded();
		pkg = this._packageToPackage(pkg);

		const data = await this._packageMetaReceiptRead(pkg);
		const {sha256, file, size} = data;
		const filePath = this._pathToPackage(pkg, file);

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
	 * Get package object by object, name, or hash.
	 * If package object is passed, check that object is known.
	 * Throw error if package is unknown.
	 *
	 * @param pkg The package.
	 * @returns Package object.
	 */
	protected _packageToPackage(pkg: PackageLike) {
		this._assertLoaded();

		let r: Package;
		if (typeof pkg === 'string') {
			const p = this._packageByUnique(pkg);
			if (!p) {
				throw new Error(`Unknown package: ${pkg}`);
			}
			r = p;
		} else {
			this._assertpackageIsMember(pkg);
			r = pkg;
		}
		return r;
	}

	/**
	 * Get package name by object, name, or hash.
	 * If package object is passed, check that object is known.
	 * If string is passed and unknown, returns string.
	 *
	 * @param pkg The package.
	 * @param mustExist Must exist.
	 * @returns Package object.
	 */
	protected _packageToName(pkg: PackageLike, mustExist = true) {
		this._assertLoaded();

		let r: string;
		if (typeof pkg === 'string') {
			const pkgObj = this._packageByUnique(pkg);
			if (!pkgObj && mustExist) {
				throw new Error(`Unknown package: ${pkg}`);
			}
			r = pkgObj ? pkgObj.name : pkg;
		} else {
			this._assertpackageIsMember(pkg);
			r = pkg.name;
		}
		return r;
	}

	/**
	 * List package parent packages.
	 *
	 * @param pkg The package.
	 * @returns Packages list.
	 */
	protected _packageParents(pkg: PackageLike) {
		this._assertLoaded();
		pkg = this._packageToPackage(pkg);

		const r: Package[] = [];
		for (let p = pkg.parent; p; p = p.parent) {
			r.push(p);
		}
		return r;
	}

	/**
	 * Read package installed receipt.
	 *
	 * @param pkg The package.
	 * @returns Package object.
	 */
	protected async _packageMetaReceiptRead(pkg: PackageLike) {
		this._assertLoaded();

		const name = this._packageToName(pkg, false);
		const pkgf = this._pathToPackageMeta(name, this.packageFile);

		const r = await readFile(pkgf, 'utf8')
			.then(s => JSON.parse(s) as IPackageReceipt)
			.catch(() => null);
		if (!r) {
			throw new Error(`Package is not installed: ${name}`);
		}
		return r;
	}

	/**
	 * Check if package install receipt exists.
	 *
	 * @param pkg The package.
	 * @returns True if the meta directory path, else false.
	 */
	protected async _packageMetaReceiptExists(pkg: PackageLike) {
		this._assertLoaded();

		const name = this._packageToName(pkg, false);
		const pkgf = this._pathToPackageMeta(name, this.packageFile);
		return access(pkgf).then(
			() => true,
			() => false
		);
	}

	/**
	 * Write package installed receipt.
	 *
	 * @param pkg The package.
	 */
	protected async _packageMetaReceiptWrite(pkg: PackageLike) {
		this._assertLoaded();
		pkg = this._packageToPackage(pkg);

		const name = this._packageToName(pkg);
		const pkgf = this._pathToPackageMeta(name, this.packageFile);
		const pkgfTmp = `${pkgf}${PART_EXT}`;

		const receipt = await this._packageMetaReceiptFromPackage(pkg);
		await writeFile(pkgfTmp, JSON.stringify(receipt, null, '\t'));
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
		this._assertLoaded();
		pkg = this._packageToPackage(pkg);

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
		this._assertLoaded();
		pkg = this._packageToPackage(pkg);

		const dir = this._pathToPackage(pkg);
		const dirMeta = this._pathToPackageMeta(pkg);
		await mkdir(dir, {recursive: true});
		await mkdir(dirMeta, {recursive: true});
	}

	/**
	 * Assert instance not inited.
	 */
	protected _assertNotInited() {
		if (this._inited) {
			throw new Error('Instance initialized');
		}
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
	 * Assert instance is active.
	 * Implies inited, not-destroyed, and lock-not-compromised assertions.
	 */
	protected _assertActive() {
		// Check everything is active in order they should report failure.
		this._assertInited();
		this._assertNotDestroyed();
	}

	/**
	 * Assert instance all loaded, including the packages list.
	 * Implies all active assertions.
	 */
	protected _assertLoaded() {
		this._assertActive();
		if (!this.loaded) {
			throw new Error('Packages list not loaded');
		}
	}

	/**
	 * Assert not current running exclusive method.
	 */
	protected _assertNotExclusive() {
		if (this._exclusive) {
			throw new Error('Already running exclusive method');
		}
	}

	/**
	 * Assert the package is in packages collection.
	 *
	 * @param pkg Package instance.
	 */
	protected _assertpackageIsMember(pkg: Package) {
		this._assertLoaded();

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
	 * Initialize instance.
	 */
	protected async _init() {
		this._assertNotInited();

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
	protected async _destroy() {
		// Destroy should always work only once if instance was inited.
		this._assertInited();
		this._assertNotDestroyed();

		this._destroyed = true;
		this._inited = false;
	}

	/**
	 * Update the package manager.
	 * Updates the packages list.
	 *
	 * @returns Update report.
	 */
	protected async _update() {
		this._assertActive();

		return this._updatePackages();
	}

	/**
	 * Check if a package is installed.
	 *
	 * @param pkg The package.
	 * @returns True if already installed, else false.
	 */
	protected async _isInstalled(pkg: PackageLike) {
		this._assertLoaded();
		pkg = this._packageToPackage(pkg);

		return this._packageMetaReceiptExists(pkg);
	}

	/**
	 * Check if a package is installed and up-to-date.
	 *
	 * @param pkg The package.
	 * @returns True if already up-to-date, else false.
	 */
	protected async _isCurrent(pkg: PackageLike) {
		this._assertLoaded();
		pkg = this._packageToPackage(pkg);

		let data: IPackageReceipt | null = null;
		try {
			data = await this._packageMetaReceiptRead(pkg);
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
	protected async _installed() {
		this._assertLoaded();

		const list: Package[] = [];
		for (const entry of await this._packageDirectories()) {
			const pkg = this._packageByName(entry);
			// eslint-disable-next-line no-await-in-loop
			if (pkg && (await this._isInstalled(pkg))) {
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
	protected async _outdated() {
		this._assertLoaded();

		const list: Package[] = [];
		for (const entry of await this._packageDirectories()) {
			const pkg = this._packageByName(entry);
			// eslint-disable-next-line no-await-in-loop
			if (pkg && !(await this._isCurrent(pkg))) {
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
	protected async _upgrade() {
		this._assertLoaded();

		const outdated = await this._outdated();
		const list: IPackageInstalled[] = [];
		for (const pkg of outdated) {
			list.push({
				package: pkg,
				// eslint-disable-next-line no-await-in-loop
				install: await this._install(pkg)
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
	protected async _install(pkg: PackageLike) {
		this._assertLoaded();
		const pkgO = (pkg = this._packageToPackage(pkg));
		const fetch = this._assertFetch();

		// If current version is installed, skip.
		const installed = await this._isCurrent(pkg);
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

		const outFile = this._pathToPackage(pkg, pkg.file);
		const tmpDir = this._pathToPackageMeta(pkg, TEMP_DIR);
		const tmpFile = pathJoin(tmpDir, `${pkg.sha256}${PART_EXT}`);
		const metaFile = this._pathToPackageMeta(pkg, this.packageFile);

		// Create temporary directory, cleanup on failure.
		await rm(tmpDir, {recursive: true, force: true});
		await mkdir(tmpDir, {recursive: true});
		try {
			// Read from installed file of from a URL.
			let input: NodeJS.ReadableStream;
			this.eventPackageDownloadBefore.trigger({
				package: pkgO
			});

			this.eventPackageDownloadProgress.trigger({
				package: pkgO,
				total: pkgO.size,
				amount: 0
			});

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

			// Create output file, monitoring write progress.
			const output = new WriterStream(tmpFile);
			output.on('wrote', () => {
				this.eventPackageDownloadProgress.trigger({
					package: pkgO,
					total: pkgO.size,
					amount: output.bytesWritten
				});
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
	protected async _remove(pkg: PackageLike) {
		this._assertLoaded();

		const dir = this._pathToPackage(pkg);
		const stat = await lstat(dir).catch(() => null);
		if (!stat) {
			return false;
		}
		const dirMeta = this._pathToPackageMeta(pkg);

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
	protected async _isObsolete(pkg: string) {
		this._assertLoaded();

		return !this._packageByName(pkg) && this._packageMetaReceiptExists(pkg);
	}

	/**
	 * List obsolete package names.
	 *
	 * @returns A list of obsolete package names.
	 */
	protected async _obsolete() {
		this._assertLoaded();

		const list: string[] = [];
		for (const entry of await this._packageDirectories()) {
			// eslint-disable-next-line no-await-in-loop
			if (await this._isObsolete(entry)) {
				list.push(entry);
			}
		}
		return list;
	}

	/**
	 * Cleanup all obsolete packages and any incomplete downloads.
	 *
	 * @returns Lists of removed packages.
	 */
	protected async _cleanup() {
		this._assertLoaded();

		const list: IPackageRemovedObsolete[] = [];
		for (const pkg of await this._packageDirectories()) {
			// Remove any temporary directory if present.
			const tmpDir = this._pathToPackageMeta(pkg, TEMP_DIR);
			// eslint-disable-next-line no-await-in-loop
			await rm(tmpDir, {recursive: true, force: true});

			// eslint-disable-next-line no-await-in-loop
			if (await this._isObsolete(pkg)) {
				this.eventPackageCleanupBefore.trigger({
					package: pkg
				});

				// eslint-disable-next-line no-await-in-loop
				const removed = await this._remove(pkg);

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
	 * List directories under package manger control.
	 *
	 * @returns The recognized package directories.
	 */
	protected async _packageDirectories() {
		this._assertLoaded();

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
		this._assertActive();
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
		this._assertActive();

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
