import {createHash as cryptoCreateHash} from 'crypto';
import {EventEmitter} from 'events';
import fse from 'fs-extra';
import {Readable} from 'stream';

import {
	HashEncoding,
	IHash,
	IRequestStream,
	IZipItterEntry,
	OnData,
	OnResponse
} from './types';

/**
 * Like array filter method, but with asyncronous callback.
 *
 * @param list The array to filter.
 * @param filter Filter function.
 * @return Filtered array.
 */
export async function arrayFilterAsync<T>(
	list: T[],
	filter: (entry: T) => Promise<any>
) {
	const r: T[] = [];
	for (const entry of list) {
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
 * @param filter Map function.
 * @return Mapped array.
 */
export async function arrayMapAsync<T, U>(
	list: T[],
	map: (entry: T) => Promise<U>
) {
	const r: U[] = [];
	for (const entry of list) {
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
	await new Promise((resolve, reject) => {
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
		obj.on('error', err => {
			done(err);
		});
	});
}

/**
 * Catch promise on error and return default value.
 *
 * @param p Promise object.
 * @param d Default value.
 * @return Resulting value.
 */
export async function promiseCatch<T, U>(p: Promise<T>, d: U) {
	let r: T | U = d;
	try {
		r = await p;
	}
	catch (err) {
		// Do nothing.
	}
	return r;
}

/**
 * Promise for lstating a path, null on error.
 *
 * @param path File path.
 * @return Stat object or null.
 */
export async function lstatExists(path: string) {
	return promiseCatch(fse.lstat(path), null);
}

/**
 * Read directory, optional skip dot files, sorted order.
 *
 * @param path Path to the directory to list.
 * @param dotfile Include dot files in the list or not.
 * @return Directory list, sorted order.
 */
export async function readDir(path: string, dotfile = true) {
	const list = await fse.readdir(path);
	const r: string[] = [];
	for (const entry of list) {
		// Skip any dot files.
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
 * @param digest Digest encoding.
 * @return Hash digest.
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
	const digest = hasher.digest(encoding);
	return hashNormalize(digest, encoding);
}

/**
 * Normalize a hash string based on the encoding.
 *
 * @param hash Hash value.
 * @param encoding Hash encoding.
 * @return Normalized hash.
 */
export function hashNormalize(hash: string, encoding: HashEncoding) {
	return encoding === 'hex' ? hash.toLowerCase() : hash;
}

/**
 * Hash file using the specified algoithms.
 *
 * @param path File path.
 * @param hashes Hash list.
 */
export async function fileHash(path: string, hashes: IHash[]) {
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
		const hashed = hasher.digest(encoding);
		hash.digest = hashNormalize(hashed, encoding);
	}
}

/**
 * Verify file hash list using the specified algoithms.
 *
 * @param path File path.
 * @param hashes Hash list.
 */
export async function fileHashVerify(path: string, hashes: IHash[]) {
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

	await fileHash(path, all.map(entry => entry.hashed));

	for (const {hash, hashed} of all) {
		const {encoding, algorithm} = hash;
		const hashedV = hashNormalize(hashed.digest, encoding);
		const expectedV = hashNormalize(hash.digest, encoding);
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
 * @return Sorted array.
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

/**
 * Stream verifier.
 *
 * @param source Request stream.
 * @param endEvent The end event name.
 * @param size Expected size.
 * @param hashes Expected hashes.
 * @param onData Data event handler, can throw to cancel download.
 */
export async function streamVerify(
	source: Readable,
	endEvent: string,
	size: number | null = null,
	hashes: IHash[] | null = null,
	onData: OnData | null = null
) {
	const hashers = (hashes || []).map(hash => ({
		hash,
		hasher: cryptoCreateHash(hash.algorithm)
	}));

	let streamSize = 0;
	source.on('data', data => {
		// Update size, check no over read.
		streamSize += data.length;
		if (size !== null && streamSize > size) {
			source.emit('error', new Error(
				`Read size too large: ${streamSize}`
			));
		}

		// Update hashers.
		hashers.forEach(entry => entry.hasher.update(data));

		if (!onData) {
			return;
		}

		try {
			onData(data);
		}
		catch (err) {
			source.emit('error', err);
		}
	});

	await streamEndError(source, 'end');

	// Verify size is not too small (too large is checked on data).
	if (size !== null && streamSize < size) {
		throw new Error(`Read size too small: ${streamSize}`);
	}

	for (const {hash, hasher} of hashers) {
		const {algorithm, encoding, digest} = hash;
		const expectedV = hashNormalize(digest, encoding);
		const hashed = hasher.digest(encoding);
		const hashedV = hashNormalize(hashed, encoding);
		if (hashedV === expectedV) {
			continue;
		}
		throw new Error(
			`Invalid ${algorithm} hash: ${hashedV} expected: ${expectedV}`
		);
	}
}

/**
 * Stream a request stream to a specified directory.
 *
 * @param source Request stream.
 * @param size Expected size.
 * @param hashes Expected hashes.
 * @param onResponse Response event handler, can throw to cancel download.
 * @param onData Data event handler, can throw to cancel download.
 */
export async function streamRequest(
	source: IRequestStream,
	size: number | null = null,
	hashes: IHash[] | null = null,
	onResponse: OnResponse | null = null,
	onData: OnData | null = null
) {
	source.on('response', response => {
		try {
			if (onResponse) {
				onResponse(response);
			}
		}
		catch (err) {
			source.emit('error', err);
			return;
		}
	});
	source.on('error', () => {
		source.abort();
	});

	await streamVerify(
		(source as any) as Readable,
		'end',
		size,
		hashes,
		onData
	);
}

/**
 * Write a request stream to a specified file.
 *
 * @param source Request stream.
 * @param path File path.
 * @param size Expected size.
 * @param hashes Expected hashes.
 * @param onResponse Response event handler, can throw to cancel download.
 * @param onData Data event handler, can throw to cancel download.
 */
export async function streamRequestDownload(
	source: IRequestStream,
	path: string,
	size: number | null = null,
	hashes: IHash[] | null = null,
	onResponse: OnResponse | null = null,
	onData: OnData | null = null
) {
	const write = fse.createWriteStream(path, {
		encoding: 'binary'
	});
	const written = streamEndError(write, 'close');
	source.pipe(write);

	await streamRequest(source, size, hashes, onResponse, onData);
	await written;
}

/**
 * Write a ZIP entry to a specified file.
 *
 * @param entry ZIP entry.
 * @param path File path.
 * @param size Expected size.
 * @param hashes Expected hashes.
 * @param onData Data event handler, can throw to cancel download.
 */
export async function zipEntryExtract(
	entry: IZipItterEntry,
	path: string,
	size: number | null = null,
	hashes: IHash[] | null = null,
	onData: OnData | null = null
) {
	const {sizeD} = entry;
	if (size === null) {
		size = sizeD;
	}
	else if (sizeD !== size) {
		throw new Error(`Unexpected extract size: ${sizeD}`);
	}

	const source = await entry.stream();
	const write = fse.createWriteStream(path, {
		encoding: 'binary'
	});
	const written = streamEndError(write, 'close');
	source.pipe(write);

	await streamVerify(source, 'end', size, hashes, onData);
	await written;
}
