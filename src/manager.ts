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

/**
 * Retry once on error.
 *
 * @param f The function to try.
 * @returns The result.
 */
async function retry<T>(f: () => Promise<T>) {
	return f().catch(async () => f());
}

export type PackageLike = Package | string;

export interface IPackageReceipt {
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
	/**
	 * Package instance.
	 */
	package: Package;
}

export interface IPackageInstallAfter {
	/**
	 * Package instance.
	 */
	package: Package;
}

export interface IPackageInstallCurrent {
	/**
	 * Package instance.
	 */
	package: Package;
}

export interface IPackageDownloadBefore {
	/**
	 * Package instance.
	 */
	package: Package;
}

export interface IPackageDownloadAfter {
	/**
	 * Package instance.
	 */
	package: Package;
}

export interface IPackageDownloadProgress {
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
	/**
	 * Package name.
	 */
	package: string;
}

export interface IPackageCleanupAfter {
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
	/**
	 * Package installed.
	 */
	package: Package;

	/**
	 * List of packages used in install, empty if already installed.
	 */
	install: Package[];
}

export interface IPackageRemovedObsolete {
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
	 * Root path.
	 */
	public readonly path: string;

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
		typeof fetch === 'undefined' ? null : (fetch as unknown as IFetch);

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
	 * Packages instance.
	 */
	protected readonly _packages: Packages;

	/**
	 * Manager constructor.
	 *
	 * @param path The path, defaults to environment variable or relative.
	 */
	constructor(path: string | null = null) {
		this.path = this._createPath(path);
		this._packages = this._createPackages();
	}

	/**
	 * Packages URL.
	 *
	 * @returns The URL.
	 */
	public get packagesUrl() {
		// eslint-disable-next-line no-process-env
		return process.env[PACKAGES_URL_ENV] || PACKAGES_URL;
	}

	/**
	 * Packages file.
	 *
	 * @returns The file.
	 */
	public get packagesFile() {
		return PACKAGES_FILE;
	}

	/**
	 * Package file.
	 *
	 * @returns The path.
	 */
	public get packageFile() {
		return PACKAGE_FILE;
	}

	/**
	 * Meta directory.
	 *
	 * @returns The directory.
	 */
	public get metaDir() {
		return META_DIR;
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
	 * Assert instance all loaded, including the packages list.
	 * Implies all active assertions.
	 */
	public assertLoaded() {
		if (!this.loaded) {
			throw new Error('Packages list not loaded');
		}
	}

	/**
	 * Ensure load if exists.
	 */
	public async ensureLoad() {
		if (!this.loaded) {
			await this.load();
		}
	}

	/**
	 * Ensure loaded.
	 */
	public async ensureLoaded() {
		await this.ensureLoad();
		this.assertLoaded();
	}

	/**
	 * Load packages if exist.
	 */
	public async load() {
		await this._packages.readIfExists();
	}

	/**
	 * Iterate over the packages.
	 *
	 * @yields Package object.
	 */
	public async *packages() {
		await this.ensureLoaded();

		for (const entry of this._packages.packages()) {
			yield entry;
		}
	}

	/**
	 * Get package by the unique name.
	 *
	 * @param name Package name.
	 * @returns The package or null.
	 */
	public async packageByName(name: string) {
		await this.ensureLoaded();

		return this._packages.byName(name);
	}

	/**
	 * Get package by the sha256 hash.
	 *
	 * @param sha256 Package sha256.
	 * @returns The package or null.
	 */
	public async packageBySha256(sha256: string) {
		await this.ensureLoaded();

		return this._packages.bySha256(sha256);
	}

	/**
	 * Get package by the sha1 hash.
	 *
	 * @param sha1 Package sha1.
	 * @returns The package or null.
	 */
	public async packageBySha1(sha1: string) {
		await this.ensureLoaded();

		return this._packages.bySha1(sha1);
	}

	/**
	 * Get package by the md5 hash.
	 *
	 * @param md5 Package md5.
	 * @returns The package or null.
	 */
	public async packageByMd5(md5: string) {
		await this.ensureLoaded();

		return this._packages.byMd5(md5);
	}

	/**
	 * Get package by the unique value.
	 *
	 * @param unique Package unique.
	 * @returns The package or null.
	 */
	public async packageByUnique(unique: string) {
		await this.ensureLoaded();

		return this._packages.byUnique(unique);
	}

	/**
	 * Read package install receipt.
	 *
	 * @param pkg The package.
	 * @returns Install receipt.
	 */
	public async receipt(pkg: PackageLike) {
		await this.ensureLoaded();

		const name = await this._asName(pkg);
		const pkgf = await this.pathToPackageMeta(name, this.packageFile);

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
	public async file(pkg: PackageLike) {
		await this.ensureLoaded();
		pkg = await this._asPackage(pkg);

		const data = await this.receipt(pkg);
		return this.pathToPackage(pkg, data.file);
	}

	/**
	 * Verify package install file, using size and hash.
	 *
	 * @param pkg The package.
	 */
	public async packageInstallVerify(pkg: PackageLike) {
		await this.ensureLoaded();
		pkg = await this._asPackage(pkg);

		const data = await this.receipt(pkg);
		const {sha256, file, size} = data;
		const filePath = await this.pathToPackage(pkg, file);

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
		// Read data, update list, write list to file, return report.
		const data = await this._requestPackages();

		// Try to determined what gets updated.
		try {
			await this.ensureLoad();
		} catch (err) {
			// Ignore errors like outdated format version.
		}

		const report = this._packages.update(data);
		await this._packages.write();
		return report;
	}

	/**
	 * Check if a package is installed.
	 *
	 * @param pkg The package.
	 * @returns True if already installed, else false.
	 */
	public async isInstalled(pkg: PackageLike) {
		await this.ensureLoaded();
		pkg = await this._asPackage(pkg);

		try {
			await this.receipt(pkg);
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
		await this.ensureLoaded();
		pkg = await this._asPackage(pkg);

		let data: IPackageReceipt | null = null;
		try {
			data = await this.receipt(pkg);
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
		await this.ensureLoaded();

		const list: Package[] = [];
		for (const entry of await this._packageDirectories()) {
			// eslint-disable-next-line no-await-in-loop
			const pkg = await this.packageByName(entry);
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
		await this.ensureLoaded();

		const list: Package[] = [];
		for (const entry of await this._packageDirectories()) {
			// eslint-disable-next-line no-await-in-loop
			const pkg = await this.packageByName(entry);
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
		await this.ensureLoaded();

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
		await this.ensureLoaded();
		pkg = await this._asPackage(pkg);
		const fetch = this._ensureFetch();

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

		const outFile = await this.pathToPackage(pkg, pkg.file);
		const tmpDir = await this.pathToPackageMeta(pkg, TEMP_DIR);
		const tmpFile = pathJoin(tmpDir, `${pkg.sha256}${TEMP_EXT}`);
		const metaFile = await this.pathToPackageMeta(pkg, this.packageFile);

		// Create temporary directory, cleanup on failure.
		await rm(tmpDir, {recursive: true, force: true});
		await mkdir(tmpDir, {recursive: true});
		const fd = await open(tmpFile, 'wx');
		try {
			const output = new WriterStream(tmpFile, {
				fd
			});

			this.eventPackageDownloadBefore.trigger({
				package: pkg
			});

			this.eventPackageDownloadProgress.trigger({
				package: pkg,
				total: pkg.size,
				amount: 0
			});

			// Create output file, monitoring write progress.
			output.on('wrote', () => {
				this.eventPackageDownloadProgress.trigger({
					package: pkg as Package,
					total: (pkg as Package).size,
					amount: output.bytesWritten
				});
			});

			let input: NodeJS.ReadableStream;
			const url = srcPkg.source;
			if (slice) {
				const [start, size] = slice;
				if (size > 0) {
					const init = {
						headers: {
							...this.headers,
							Range: `bytes=${start}-${start + size - 1}`
						}
					};
					const res = await retry(async () => fetch(url, init)).catch(
						err => {
							if (err) {
								throw new Error(
									this._fetchErrorMessage(err as Error)
								);
							}
							throw err;
						}
					);
					const {status} = res;
					if (status !== 206) {
						throw new Error(
							`Invalid resume status: ${status}: ${url}`
						);
					}
					const cl = res.headers.get('content-length');
					if (cl && +cl !== size) {
						throw new Error(
							`Invalid resume content-length: ${cl}: ${url}`
						);
					}
					const {body} = res;
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
				const init = {
					headers: this.headers
				};
				const res = await retry(async () => fetch(url, init)).catch(
					err => {
						if (err) {
							throw new Error(
								this._fetchErrorMessage(err as Error)
							);
						}
						throw err;
					}
				);
				const {status} = res;
				if (status !== 200) {
					throw new Error(
						`Invalid download status: ${status}: ${url}`
					);
				}
				const cl = res.headers.get('content-length');
				if (cl && +cl !== srcPkg.size) {
					throw new Error(
						`Invalid download content-length: ${cl}: ${url}`
					);
				}
				const {body} = res;
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
				package: pkg
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
		await this.ensureLoaded();

		const dir = await this.pathToPackage(pkg);
		const stat = await lstat(dir).catch(() => null);
		if (!stat) {
			return false;
		}
		const dirMeta = await this.pathToPackageMeta(pkg);

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
		await this.ensureLoaded();

		return (
			!pkg.startsWith('.') &&
			!(await this.packageByName(pkg)) &&
			access(await this.pathToPackageMeta(pkg)).then(
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
		await this.ensureLoaded();

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
		await this.ensureLoaded();

		const list: IPackageRemovedObsolete[] = [];
		for (const pkg of await this._packageDirectories()) {
			// Remove any temporary directory if present.
			// eslint-disable-next-line no-await-in-loop
			const tmpDir = await this.pathToPackageMeta(pkg, TEMP_DIR);
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
	public async pathToPackage(pkg: PackageLike, ...parts: string[]) {
		await this.ensureLoaded();

		return this.pathTo(await this._asName(pkg), ...parts);
	}

	/**
	 * Join path on package meta path.
	 *
	 * @param pkg The package.
	 * @param parts Path parts.
	 * @returns Joined path.
	 */
	public async pathToPackageMeta(pkg: PackageLike, ...parts: string[]) {
		await this.ensureLoaded();

		return this.pathTo(await this._asName(pkg), this.metaDir, ...parts);
	}

	/**
	 * Get package object by object, name, or hash.
	 * Throw error if package is unknown.
	 *
	 * @param pkg The package.
	 * @returns Package object.
	 */
	protected async _asPackage(pkg: PackageLike) {
		await this.ensureLoaded();

		if (typeof pkg === 'string') {
			const p = await this.packageByUnique(pkg);
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
	protected async _asName(pkg: PackageLike) {
		await this.ensureLoaded();

		return typeof pkg === 'string'
			? (await this.packageByUnique(pkg))?.name ?? pkg
			: pkg.name;
	}

	/**
	 * Write package installed receipt.
	 *
	 * @param pkg The package.
	 */
	protected async _packageMetaReceiptWrite(pkg: PackageLike) {
		await this.ensureLoaded();
		pkg = await this._asPackage(pkg);

		const pkgf = await this.pathToPackageMeta(pkg, this.packageFile);
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
		await this.ensureLoaded();
		pkg = await this._asPackage(pkg);

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
		await this.ensureLoaded();
		pkg = await this._asPackage(pkg);

		const dir = await this.pathToPackage(pkg);
		const dirMeta = await this.pathToPackageMeta(pkg);
		await mkdir(dir, {recursive: true});
		await mkdir(dirMeta, {recursive: true});
	}

	/**
	 * Ensure fetch-like function is set.
	 *
	 * @returns The fetch-like function.
	 */
	protected _ensureFetch(): IFetch {
		const {fetch} = this;
		if (!fetch) {
			throw new Error('Default fetch not available');
		}
		return fetch;
	}

	/**
	 * Get fetch error messsage.
	 *
	 * @param error Error object.
	 * @returns Error message.
	 */
	protected _fetchErrorMessage(error: Error) {
		const {message, cause} = error;
		let msg = message;
		if (cause) {
			const {name, code} = cause as {name: unknown; code: unknown};
			const info = [name, code].filter(v => v).join(' ');
			if (info) {
				msg += ` (${info})`;
			}
		}
		return msg;
	}

	/**
	 * List directories under package manger control.
	 *
	 * @returns The recognized package directories.
	 */
	protected async _packageDirectories() {
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
		const fetch = this._ensureFetch();

		const url = this.packagesUrl;
		const init = {
			headers: {
				...this.headers,
				// eslint-disable-next-line @typescript-eslint/naming-convention
				'Cache-Control': 'max-age=0',
				Pragma: 'no-cache'
			}
		};
		const res = await retry(async () => fetch(url, init)).catch(err => {
			if (err) {
				throw new Error(this._fetchErrorMessage(err as Error));
			}
			throw err;
		});
		const {status} = res;
		if (status !== 200) {
			throw new Error(`Invalid response status: ${status}: ${url}`);
		}
		return res.text();
	}

	/**
	 * Ensure base directories exists.
	 */
	protected async _ensureDirs() {
		await mkdir(this.path, {recursive: true});
		await mkdir(this.pathToMeta(), {recursive: true});
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
		return path || process.env[PATH_ENV] || MAIN_DIR;
	}

	/**
	 * Create the Packages instance.
	 *
	 * @returns Packages instance.
	 */
	protected _createPackages() {
		return new Packages(this.pathToMeta(this.packagesFile));
	}
}
