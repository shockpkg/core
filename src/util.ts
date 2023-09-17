import {constants as FSC, closeSync, unlinkSync, Mode} from 'node:fs';
import {open, FileHandle, unlink} from 'node:fs/promises';
import {getRandomValues} from 'node:crypto';

import {TEMP_EXT} from './constants';

const {O_CREAT, O_EXCL} = FSC;

let onexitCallbacks: Set<(code: number) => unknown>;

/**
 * An onexit hook that supports different shutdown triggers.
 *
 * @param func Callback function.
 * @returns Function to unhoook the callback function.
 */
export function onexit(func: (code: number) => unknown) {
	if (!onexitCallbacks) {
		onexitCallbacks = new Set();
		// eslint-disable-next-line jsdoc/require-jsdoc
		const exit = (signal: number) => {
			const code = 128 + signal;
			for (const c of onexitCallbacks) {
				c(code);
			}
			if (signal) {
				// eslint-disable-next-line no-process-exit
				process.exit(code);
			}
		};
		process.once('exit', () => exit(0));
		process.once('beforeExit', () => exit(-128));
		process.once('SIGINT', () => exit(2));
		process.once('SIGTERM', () => exit(15));
		process.on('message', m => {
			if (m === 'shutdown') {
				exit(-128);
			}
		});
	}
	onexitCallbacks.add(func);
	return () => {
		onexitCallbacks.delete(func);
	};
}

let rb5: Buffer | null = null;

/**
 * Create temporary file that will be cleaned up if not moved elsewhere.
 *
 * @param func Callback function.
 * @param prefix The part file prefix, if any.
 * @param flags The flags passed to open, with O_CREAT | O_EXCL.
 * @param mode The mode passed to open.
 */
export async function tmpfile(
	func: (fh: FileHandle, fp: string) => unknown,
	prefix?: string,
	flags?: number,
	mode?: Mode
) {
	// eslint-disable-next-line no-bitwise
	const flg = (flags || 0) | O_CREAT | O_EXCL;
	const pre = prefix || '';
	let fp = '';
	let fh: FileHandle;
	const offexit = onexit(() => {
		if (fh) {
			if (fh.fd >= 0) {
				closeSync(fh.fd);
			}
			if (fp) {
				try {
					unlinkSync(fp);
				} catch (err) {
					if ((err as {code?: unknown})?.code !== 'ENOENT') {
						throw err;
					}
				}
			}
		}
	});
	for (;;) {
		getRandomValues((rb5 = rb5 || Buffer.alloc(5)));
		const suff = (rb5.readUint32LE() + rb5.readUint8(1) * 0x100000000)
			.toString(32)
			.padStart(8, '0');
		fp = `${pre}.${suff}${TEMP_EXT}`;
		try {
			// eslint-disable-next-line no-await-in-loop
			fh = await open(fp, flg, mode);
			break;
		} catch (err) {
			if ((err as {code?: unknown})?.code !== 'EEXIST') {
				throw err;
			}
		}
	}
	try {
		await func(fh, fp);
	} finally {
		await fh.close();
		await unlink(fp).catch(err => {
			if ((err as {code?: unknown})?.code !== 'ENOENT') {
				throw err;
			}
		});
		offexit();
	}
}
