import {createReadStream} from 'fs';
import {
	access,
	lstat,
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	writeFile
} from 'fs/promises';
import {join as pathJoin} from 'path';
import {pipeline, Transform} from 'stream';
import {promisify} from 'util';
import {createHash} from 'crypto';

import {
	MAIN_DIR,
	META_DIR,
	PACKAGE_FILE,
	PACKAGES_FILE,
	PACKAGES_URL,
	PACKAGES_URL_ENV,
	PATH_ENV,
	TEMP_DIR
} from './constants';
import {Dispatcher} from './dispatcher';
import {createWriterStream, EmptyStream, SliceStream} from './stream';
import {Lock} from './lock';
import {Package} from './package';
import {Packages} from './packages';
import {
	IPackageCleanupAfter,
	IPackageCleanupBefore,
	IPackageDownloadAfter,
	IPackageDownloadBefore,
	IPackageDownloadProgress,
	IPackageExtractAfter,
	IPackageExtractBefore,
	IPackageExtractProgress,
	IPackageInstallAfter,
	IPackageInstallBefore,
	IPackageInstallCurrent,
	IPackageInstalled,
	IPackageReceipt,
	IPackageRemovedObsolete,
	PackageLike
} from './types';
import {IFetch, fetch} from './fetch';
import {arrayFilterAsync, arrayMapAsync, dependSort} from './util';
import {NAME, VERSION} from './meta';

const pipe = promisify(pipeline);

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
	 * A node-fetch similar interface requiring only a sebset of features.
	 */
	public fetch: IFetch = fetch;

	/**
	 * Package install before events.
	 */
	public readonly eventPackageInstallBefore =
		// eslint-disable-next-line no-invalid-this
		new Dispatcher<IPackageInstallBefore>(this);

	/**
	 * Package install after events.
	 */
	public readonly eventPackageInstallAfter =
		// eslint-disable-next-line no-invalid-this
		new Dispatcher<IPackageInstallAfter>(this);

	/**
	 * Package install current events.
	 */
	public readonly eventPackageInstallCurrent =
		// eslint-disable-next-line no-invalid-this
		new Dispatcher<IPackageInstallCurrent>(this);

	/**
	 * Package download before events.
	 */
	public readonly eventPackageDownloadBefore =
		// eslint-disable-next-line no-invalid-this
		new Dispatcher<IPackageDownloadBefore>(this);

	/**
	 * Package download after events.
	 */
	public readonly eventPackageDownloadAfter =
		// eslint-disable-next-line no-invalid-this
		new Dispatcher<IPackageDownloadAfter>(this);

	/**
	 * Package download progress events.
	 */
	public readonly eventPackageDownloadProgress =
		// eslint-disable-next-line no-invalid-this
		new Dispatcher<IPackageDownloadProgress>(this);

	/**
	 * Package extract before events.
	 */
	public readonly eventPackageExtractBefore =
		// eslint-disable-next-line no-invalid-this
		new Dispatcher<IPackageExtractBefore>(this);

	/**
	 * Package extract after events.
	 */
	public readonly eventPackageExtractAfter =
		// eslint-disable-next-line no-invalid-this
		new Dispatcher<IPackageExtractAfter>(this);

	/**
	 * Package extract progress events.
	 */
	public readonly eventPackageExtractProgress =
		// eslint-disable-next-line no-invalid-this
		new Dispatcher<IPackageExtractProgress>(this);

	/**
	 * Package cleanup before events.
	 */
	public readonly eventPackageCleanupBefore =
		// eslint-disable-next-line no-invalid-this
		new Dispatcher<IPackageCleanupBefore>(this);

	/**
	 * Package cleanup after events.
	 */
	public readonly eventPackageCleanupAfter =
		// eslint-disable-next-line no-invalid-this
		new Dispatcher<IPackageCleanupAfter>(this);

	/**
	 * Package list error events.
	 */
	public readonly eventPackageListError =
		// eslint-disable-next-line no-invalid-this
		new Dispatcher<Error>(this);

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
	 * Temp directory.
	 */
	protected readonly _tempDir: string = TEMP_DIR;

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
	 * Lock file instance.
	 */
	protected readonly _lock: Lock;

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
		const lock = this._createLock();
		lock.eventCompromised.on(() => {
			// Do nothing, instead fail on next assert call.
		});
		this._lock = lock;
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
	 * Temp directory.
	 *
	 * @returns The directory.
	 */
	public get tempDir() {
		return this._tempDir;
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
	 * The lock file compromised.
	 *
	 * @returns Is compromised.
	 */
	public get lockCompromised() {
		return this._lock.compromised;
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
	 * Packages ordered by dependencies.
	 *
	 * @param pkgs Packages list.
	 * @returns Packages list, sorted order.
	 */
	public packagesDependOrdered(pkgs: PackageLike[]) {
		// eslint-disable-next-line no-sync
		return this._exclusiveSync(() => this._packagesDependOrdered(pkgs));
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
	 * Install multiple packages, higher dependencies first.
	 *
	 * @param pkgs Packages list.
	 * @returns Installed list.
	 */
	public async installMulti(pkgs: PackageLike[]) {
		return this._exclusiveAsync(async () => this._installMulti(pkgs));
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
	 * Join path on the temp folder path.
	 *
	 * @param parts Path parts.
	 * @returns Joined path.
	 */
	public pathToTemp(...parts: string[]) {
		return this.pathToMeta(this.tempDir, ...parts);
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
		await pipe(stream, hash);

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
	 * Packages ordered by dependencies.
	 *
	 * @param pkgs Packages list.
	 * @returns Packages list, sorted order.
	 */
	protected _packagesDependOrdered(pkgs: PackageLike[]) {
		this._assertLoaded();

		const list = pkgs.map(pkg => this._packageToPackage(pkg));
		return dependSort(list, pkg => this._packageParents(pkg));
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
	 * Write package installed receipt.
	 *
	 * @param pkg The package.
	 */
	protected async _packageMetaReceiptWrite(pkg: PackageLike) {
		this._assertLoaded();
		pkg = this._packageToPackage(pkg);

		const name = this._packageToName(pkg);
		const pkgf = this._pathToPackageMeta(name, this.packageFile);

		const receipt = await this._packageMetaReceiptFromPackage(pkg);
		await writeFile(pkgf, JSON.stringify(receipt, null, '\t'));
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
	 * Check if package meta directory exists.
	 *
	 * @param pkg The package.
	 * @returns True if the meta directory path, else false.
	 */
	protected async _packageMetaDirExists(pkg: PackageLike) {
		this._assertLoaded();

		const dir = this._pathToPackageMeta(pkg);
		return access(dir).then(
			() => true,
			() => false
		);
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
	 * Assert instance lock was not compromised.
	 */
	protected _assertLockNotCompromised() {
		if (this.lockCompromised) {
			throw new Error('Instance lock file compromised');
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
		this._assertLockNotCompromised();
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
	 * Initialize instance.
	 */
	protected async _init() {
		this._assertNotInited();

		await this._ensureDirs();
		await this._lock.aquire();
		try {
			await this._packages.readIfExists();
		} catch (err) {
			// eslint-disable-next-line no-sync
			this.eventPackageListError.triggerSync(err as Error);
		}

		this._inited = true;
		this._destroyed = false;
	}

	/**
	 * Destroy instance.
	 */
	protected async _destroy() {
		// Destroy should always work only once if instance was inited.
		this._assertInited();
		this._assertNotDestroyed();

		// Lock may have been compromised, only release if currently held.
		if (this._lock.held) {
			await this._lock.release();
		}

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

		try {
			await this._packageMetaReceiptRead(pkg);
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

		const dirList = await this._packagesDirList();
		const filtered = await arrayFilterAsync(dirList, async entry => {
			const pkg = this._packageByName(entry);
			const installed = pkg && (await this._isInstalled(pkg));
			return installed;
		});
		return this._packagesDependOrdered(filtered);
	}

	/**
	 * List all outdated packages.
	 *
	 * @returns The list of outdated package objects.
	 */
	protected async _outdated() {
		this._assertLoaded();

		const dirList = await this._packagesDirList();
		const filtered = await arrayFilterAsync(dirList, async entry => {
			const pkg = this._packageByName(entry);
			return pkg && !(await this._isCurrent(pkg));
		});
		return this._packagesDependOrdered(filtered);
	}

	/**
	 * Upgrade any outdated packages.
	 *
	 * @returns List of packages upgraded.
	 */
	protected async _upgrade() {
		this._assertLoaded();

		const outdated = await this._outdated();
		return this._installMulti(outdated);
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

		// If current version is installed, skip.
		const installed = await this._isCurrent(pkg);
		if (installed) {
			// eslint-disable-next-line no-sync
			this.eventPackageInstallCurrent.triggerSync({
				package: pkg
			});
			return [];
		}

		// Find the closest current installed parent, if any.
		const packages: Package[] = [pkg];
		let hasCurrent = false;
		for (let p = pkg.parent; p; p = p.parent) {
			packages.push(p);
			// eslint-disable-next-line no-await-in-loop
			if (await this._isCurrent(p)) {
				hasCurrent = true;
				break;
			}
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

		// eslint-disable-next-line no-sync
		this.eventPackageInstallBefore.triggerSync({
			package: pkg
		});

		const outFile = this._pathToPackage(pkg, pkg.file);
		const tmpFile = this.pathToTemp(`${pkg.name}.part`);

		// Create temporary directory, cleanup on failure.
		await this._tempDirEnsure(true);
		try {
			// Read from installed file of from a URL.
			let input: NodeJS.ReadableStream;
			if (hasCurrent) {
				// eslint-disable-next-line no-sync
				this.eventPackageExtractBefore.triggerSync({
					package: pkgO
				});

				// eslint-disable-next-line no-sync
				this.eventPackageExtractProgress.triggerSync({
					package: pkgO,
					total: pkgO.size,
					amount: 0
				});

				const srcFile = this._pathToPackage(srcPkg, srcPkg.file);
				if (slice) {
					const [start, size] = slice;
					if (size > 0) {
						input = createReadStream(srcFile, {
							start,
							end: start + size - 1
						});
					} else if (size === 0) {
						input = new EmptyStream();
					} else {
						throw new Error(
							`Cannot extract negative size: ${size}`
						);
					}
				} else {
					input = createReadStream(srcFile);
				}
			} else {
				// eslint-disable-next-line no-sync
				this.eventPackageDownloadBefore.triggerSync({
					package: pkgO
				});

				// eslint-disable-next-line no-sync
				this.eventPackageDownloadProgress.triggerSync({
					package: pkgO,
					total: pkgO.size,
					amount: 0
				});

				const url = srcPkg.source;
				if (slice) {
					const [start, size] = slice;
					if (size > 0) {
						const response = await this.fetch(url, {
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
						input = response.body;
					} else if (size === 0) {
						input = new EmptyStream();
					} else {
						throw new Error(
							`Cannot download negative size: ${size}`
						);
					}
				} else {
					const response = await this.fetch(srcPkg.source, {
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
					input = response.body;
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
			const output = createWriterStream(tmpFile);
			output.on('wrote', () => {
				if (hasCurrent) {
					// eslint-disable-next-line no-sync
					this.eventPackageExtractProgress.triggerSync({
						package: pkgO,
						total: pkgO.size,
						amount: output.bytesWritten
					});
				} else {
					// eslint-disable-next-line no-sync
					this.eventPackageDownloadProgress.triggerSync({
						package: pkgO,
						total: pkgO.size,
						amount: output.bytesWritten
					});
				}
			});

			// Pipe all the streams through the pipeline.
			// Work around types failing on variable args.
			await (pipe as (...args: unknown[]) => Promise<void>)(
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

			if (hasCurrent) {
				// eslint-disable-next-line no-sync
				this.eventPackageExtractAfter.triggerSync({
					package: pkgO
				});
			} else {
				// eslint-disable-next-line no-sync
				this.eventPackageDownloadAfter.triggerSync({
					package: pkgO
				});
			}

			// Move the final file into place and write package file.
			// Write the package receipt last, means successful install.
			await this._packageDirsEnsure(pkg);
			await rm(outFile, {force: true});
			await rename(tmpFile, outFile);
			await this._packageMetaReceiptWrite(pkg);
		} finally {
			await this._tempDirRemove();
		}

		// eslint-disable-next-line no-sync
		this.eventPackageInstallAfter.triggerSync({
			package: pkg
		});

		return packages;
	}

	/**
	 * Install multiple package, higher dependencies first.
	 *
	 * @param pkgs Packages list.
	 * @returns Installed list.
	 */
	protected async _installMulti(pkgs: PackageLike[]) {
		this._assertLoaded();

		const list = this._packagesDependOrdered(pkgs);
		return (await arrayMapAsync(list, async pkg => ({
			package: pkg,
			install: await this._install(pkg)
		}))) as IPackageInstalled[];
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

		const r =
			!this._packageByName(pkg) &&
			(await this._packageMetaDirExists(pkg));
		return r;
	}

	/**
	 * List obsolete package names.
	 *
	 * @returns A list of obsolete package names.
	 */
	protected async _obsolete() {
		this._assertLoaded();

		const dirList = await this._packagesDirList();
		return arrayFilterAsync(dirList, async entry =>
			this._isObsolete(entry)
		);
	}

	/**
	 * Cleanup all obsolete packages.
	 *
	 * @returns Lists of removed packages.
	 */
	protected async _cleanup() {
		this._assertLoaded();

		// Remove the temporary directory if present.
		await this._tempDirRemove();

		// Remove the obsolete packages.
		const obsolete = await this._obsolete();
		return (await arrayMapAsync(obsolete, async pkg => {
			// eslint-disable-next-line no-sync
			this.eventPackageCleanupBefore.triggerSync({
				package: pkg
			});

			const removed = await this._remove(pkg);

			// eslint-disable-next-line no-sync
			this.eventPackageCleanupAfter.triggerSync({
				package: pkg,
				removed
			});
			return {
				package: pkg,
				removed
			};
		})) as IPackageRemovedObsolete[];
	}

	/**
	 * List all packages in the directory.
	 * Only those directories with the meta directory are returned.
	 * Dot directories are also always skipped.
	 *
	 * @returns List of all recognized package directories.
	 */
	protected async _packagesDirList() {
		this._assertLoaded();

		const dirList = (await readdir(this.path, {withFileTypes: true}))
			.filter(e => !e.name.startsWith('.') && e.isDirectory())
			.map(e => e.name)
			.sort();
		return arrayFilterAsync(dirList, async entry =>
			this._packageMetaDirExists(entry)
		);
	}

	/**
	 * Request the packages file.
	 *
	 * @returns File contents as string.
	 */
	protected async _requestPackages() {
		this._assertActive();

		const url = this.packagesUrl;
		const response = await this.fetch(url, {
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
	 * Ensure temp directory exists.
	 *
	 * @param clean Clean existing.
	 */
	protected async _tempDirEnsure(clean = false) {
		if (clean) {
			await this._tempDirRemove();
		}
		await mkdir(this.pathToTemp(), {recursive: true});
	}

	/**
	 * Ensure temp directory removed.
	 */
	protected async _tempDirRemove() {
		await rm(this.pathToTemp(), {recursive: true, force: true});
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
	 * Create the Lock instance.
	 *
	 * @returns Lock instance.
	 */
	protected _createLock() {
		return new Lock(this.pathMeta);
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
