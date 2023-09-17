/* eslint-disable max-nested-callbacks */

import {describe, it} from 'node:test';
import {ok, strictEqual} from 'node:assert';
import {rm, mkdir, access, rename, readFile} from 'node:fs/promises';
import {constants as FSC} from 'node:fs';
import {join as pathJoin, basename} from 'node:path';

import {tmpfile} from './util';

const {O_WRONLY} = FSC;

const withTempDir = (i => async (func: (dir: string) => unknown) => {
	const dir = `./spec/tmp/util/${i++}`;
	await rm(dir, {recursive: true, force: true});
	try {
		await mkdir(dir, {recursive: true});
		await func(dir);
	} finally {
		await rm(dir, {recursive: true, force: true});
	}
})(0);

void describe('util', () => {
	void describe('tmpfile', () => {
		void it('cleaned', async () => {
			await withTempDir(async dir => {
				const file = 'test.txt';
				let tmpf = '';
				const dest = pathJoin(dir, file);
				await tmpfile((_, fp) => {
					tmpf = fp;
				}, dest);
				const exists = await access(tmpf).then(
					() => true,
					() => false
				);
				strictEqual(exists, false);
				ok(basename(tmpf).startsWith(file));
			});
		});

		void it('closed', async () => {
			await withTempDir(async dir => {
				let tmpf = '';
				const dest = pathJoin(dir, 'test.txt');
				await tmpfile(async (fh, fp) => {
					tmpf = fp;
					await fh.close();
				}, dest);
				const exists = await access(tmpf).then(
					() => true,
					() => false
				);
				strictEqual(exists, false);
			});
		});

		void it('renamed', async () => {
			await withTempDir(async dir => {
				const dest = pathJoin(dir, 'test.txt');
				await tmpfile(async (fh, fp) => {
					await fh.close();
					await rename(fp, dest);
				}, dest);
				const exists = await access(dest).then(
					() => true,
					() => false
				);
				strictEqual(exists, true);
			});
		});

		void it('writable', async () => {
			await withTempDir(async dir => {
				let tmpf = '';
				const dest = pathJoin(dir, 'test.txt');
				const data = 'Testing123';
				let read = '';
				await tmpfile(
					async (fh, fp) => {
						tmpf = fp;
						await fh.write(data);
						await fh.close();
						read = await readFile(tmpf, 'utf8');
					},
					dest,
					O_WRONLY
				);
				const exists = await access(tmpf).then(
					() => true,
					() => false
				);
				strictEqual(exists, false);
				strictEqual(read, data);
			});
		});
	});
});
