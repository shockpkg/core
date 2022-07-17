import {createHash as cryptoCreateHash} from 'crypto';
import {EventEmitter} from 'events';

import fse from 'fs-extra';

import {HashEncoding, IHash} from './types';

/**
 * Like array filter method, but with asyncronous callback.
 *
 * @param list The array to filter.
 * @param filter Filter function.
 * @returns Filtered array.
 */
export async function arrayFilterAsync<T>(
	list: Readonly<T[]>,
	filter: (entry: T) => Promise<any>
) {
	const r: T[] = [];
	for (const entry of list) {
		// eslint-disable-next-line no-await-in-loop
		if (await filter(entry)) {
			r.push(entry);
		}
	}
	return r;
}

/**
 * Like array map method, but with asyncronous callback.
 *
 * @param list The array to map.
 * @param map Map function.
 * @returns Mapped array.
 */
export async function arrayMapAsync<T, U>(
	list: Readonly<T[]>,
	map: (entry: T) => Promise<U>
) {
	const r: U[] = [];
	for (const entry of list) {
		// eslint-disable-next-line no-await-in-loop
		r.push(await map(entry));
	}
	return r;
}

/**
 * Promise for event emitter object to end successfully or in an error.
 *
 * @param obj Event emitter.
 * @param end The end event name.
 */
export async function streamEndError(obj: EventEmitter, end: string) {
	await new Promise<void>((resolve, reject) => {
		/**
		 * Done callback.
		 *
		 * @param err Error object or null.
		 */
		const done = (err: Error | null) => {
			if (err) {
				reject(err);
				return;
			}
			resolve();
		};
		obj.on(end, () => {
			done(null);
		});
		obj.on('error', (err: Error) => {
			done(err);
		});
	});
}

/**
 * Catch promise on error and return default value.
 *
 * @param p Promise object.
 * @param d Default value.
 * @returns Resulting value.
 */
export async function promiseCatch<T, U>(p: Promise<T>, d: U) {
	let r: T | U = d;
	try {
		r = await p;
	} catch (err) {
		// Do nothing.
	}
	return r;
}

/**
 * Promise for lstating a path, null on error.
 *
 * @param path File path.
 * @returns Stat object or null.
 */
export async function lstatExists(path: string) {
	return promiseCatch(fse.lstat(path), null);
}

/**
 * Read directory, optional skip dot files, sorted order.
 *
 * @param path Path to the directory to list.
 * @param dotfile Include dot files in the list or not.
 * @returns Directory list, sorted order.
 */
export async function readDir(path: string, dotfile = true) {
	const list = await fse.readdir(path);
	const r: string[] = [];
	for (const entry of list) {
		// Skip any dot files.
		// eslint-disable-next-line @typescript-eslint/prefer-string-starts-ends-with
		if (!dotfile && entry.charAt(0) === '.') {
			continue;
		}
		r.push(entry);
	}
	r.sort();
	return r;
}

/**
 * Hash file using the specified algoithm.
 *
 * @param path File path.
 * @param algorithm Hash algorithm.
 * @param encoding Digest encoding.
 * @returns Hash digest.
 */
export async function hashFile(
	path: string,
	algorithm: string,
	encoding: HashEncoding
) {
	const hasher = cryptoCreateHash(algorithm);
	const reader = fse.createReadStream(path);
	reader.on('data', data => {
		hasher.update(data);
	});
	await streamEndError(reader, 'close');
	return hasher.digest(encoding);
}

/**
 * Hash file using the specified algoithms.
 *
 * @param path File path.
 * @param hashes Hash list.
 */
export async function fileHash(path: string, hashes: Readonly<IHash[]>) {
	const hashers = hashes.map(hash => ({
		hash,
		hasher: cryptoCreateHash(hash.algorithm)
	}));

	const reader = fse.createReadStream(path);
	reader.on('data', data => {
		// Update hashers.
		hashers.forEach(entry => entry.hasher.update(data));
	});

	await streamEndError(reader, 'close');

	// Verify hashes.
	for (const {hash, hasher} of hashers) {
		const {encoding} = hash;
		hash.digest = hasher.digest(encoding);
	}
}

/**
 * Verify file hash list using the specified algoithms.
 *
 * @param path File path.
 * @param hashes Hash list.
 */
export async function fileHashVerify(
	path: string,
	hashes: Readonly<Readonly<IHash>[]>
) {
	const all = hashes.map(hash => {
		const hashed: IHash = {
			algorithm: hash.algorithm,
			encoding: hash.encoding,
			digest: hash.digest
		};
		return {
			hash,
			hashed
		};
	});

	await fileHash(
		path,
		all.map(entry => entry.hashed)
	);

	for (const {hash, hashed} of all) {
		const {algorithm} = hash;
		const hashedV = hashed.digest;
		const expectedV = hash.digest;
		if (hashedV === expectedV) {
			continue;
		}
		throw new Error(
			`Invalid ${algorithm} hash: ${hashedV} expected: ${expectedV}`
		);
	}
}

/**
 * Verify file size or throw error.
 *
 * @param path File path.
 * @param size Expected size.
 */
export async function fileSizeVerify(path: string, size: number) {
	const stat = await fse.lstat(path);
	const fSize = stat.size;
	if (fSize !== size) {
		throw new Error(`Invalid file size: ${fSize} expected: ${size}`);
	}
}

/**
 * Sort entries on dependencies listed for each entry.
 * Sorts the array in-place.
 *
 * @param list The array to sort.
 * @param deps Get the list of dependencies for each entry.
 * @returns Sorted array.
 */
export function dependSort<T>(list: T[], deps: (entry: T) => T[]) {
	const m = new Map<T, Set<T>>();
	for (const entry of list) {
		m.set(entry, new Set(deps(entry)));
	}
	return list.sort((a, b) => {
		const aDeps = m.get(a) as Set<T>;
		if (aDeps.has(b)) {
			return 1;
		}
		const bDeps = m.get(b) as Set<T>;
		if (bDeps.has(a)) {
			return -1;
		}
		return 0;
	});
}
