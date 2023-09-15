import {describe, it, beforeEach, afterEach} from 'node:test';
import {deepStrictEqual, strictEqual} from 'node:assert';
import {Readable, pipeline} from 'node:stream';
import {join as pathJoin} from 'node:path';
import {promisify} from 'node:util';
import {rm, mkdir, lstat} from 'node:fs/promises';

import {createWriterStream, EmptyStream, SliceStream} from './stream';

const pipe = promisify(pipeline);

const tmpPath = './spec/tmp/stream';

const MB = 1024 * 1024;

class Reader extends Readable {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	public _read(size: number) {
		for (let i = 0; i < 5; i++) {
			const b = Buffer.alloc(MB);
			for (let i = 0; i < b.length; i++) {
				b[i] = i % 256;
			}
			this.push(b);
		}
		this.push(null);
	}
}

void describe('stream', () => {
	void describe('createWriterStream', () => {
		void beforeEach(async () => {
			await rm(tmpPath, {recursive: true, force: true});
		});

		void afterEach(async () => {
			await rm(tmpPath, {recursive: true, force: true});
		});

		void it('wrote', async () => {
			await mkdir(tmpPath, {recursive: true});
			const file = pathJoin(tmpPath, 'tmp.bin');
			const reader = new Reader();
			const writer = createWriterStream(file);
			const wrotes: number[] = [];
			writer.on('wrote', () => {
				wrotes.push(writer.bytesWritten);
			});
			await pipe(reader, writer);
			strictEqual((await lstat(file)).size, 5 * MB);
			deepStrictEqual(wrotes, [MB, 2 * MB, 3 * MB, 4 * MB, 5 * MB]);
		});
	});

	void describe('SliceStream', () => {
		void it('2MB - 10b', async () => {
			const reader = new Reader();
			const transform = new SliceStream(2 * MB, 10);
			const datas: number[][] = [];
			transform.on('data', (data: Buffer) => {
				datas.push([...data]);
			});
			await pipe(reader, transform);
			deepStrictEqual(datas, [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]]);
		});

		void it('2MB - 0b', async () => {
			const reader = new Reader();
			const transform = new SliceStream(2 * MB, 0);
			const datas: number[][] = [];
			transform.on('data', (data: Buffer) => {
				datas.push([...data]);
			});
			await pipe(reader, transform);
			deepStrictEqual(datas, []);
		});

		void it('2MB+1 - 0b', async () => {
			const reader = new Reader();
			const transform = new SliceStream(2 * MB + 1, 0);
			const datas: number[][] = [];
			transform.on('data', (data: Buffer) => {
				datas.push([...data]);
			});
			await pipe(reader, transform);
			deepStrictEqual(datas, []);
		});

		void it('2MB+1 - 10b', async () => {
			const reader = new Reader();
			const transform = new SliceStream(2 * MB + 1, 10);
			const datas: number[][] = [];
			transform.on('data', (data: Buffer) => {
				datas.push([...data]);
			});
			await pipe(reader, transform);
			deepStrictEqual(datas, [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]]);
		});

		void it('2MB-1 - 10b', async () => {
			const reader = new Reader();
			const transform = new SliceStream(2 * MB - 1, 10);
			const datas: number[][] = [];
			transform.on('data', (data: Buffer) => {
				datas.push([...data]);
			});
			await pipe(reader, transform);
			deepStrictEqual(datas, [[0xff], [0, 1, 2, 3, 4, 5, 6, 7, 8]]);
		});

		void it('2MB-4 - 4b', async () => {
			const reader = new Reader();
			const transform = new SliceStream(2 * MB - 4, 4);
			const datas: number[][] = [];
			transform.on('data', (data: Buffer) => {
				datas.push([...data]);
			});
			await pipe(reader, transform);
			deepStrictEqual(datas, [[0xfc, 0xfd, 0xfe, 0xff]]);
		});

		void it('1.5MB - 2MB', async () => {
			const reader = new Reader();
			const transform = new SliceStream(1.5 * MB, 2 * MB);
			const datas: Buffer[] = [];
			transform.on('data', (data: Buffer) => {
				datas.push(data);
			});
			await pipe(reader, transform);
			strictEqual(datas.length, 3);
			strictEqual(datas[0].length, 0.5 * MB);
			strictEqual(datas[1].length, MB);
			strictEqual(datas[2].length, 0.5 * MB);
		});

		void it('4MB - -1', async () => {
			const reader = new Reader();
			const transform = new SliceStream(4 * MB, -1);
			const datas: Buffer[] = [];
			transform.on('data', (data: Buffer) => {
				datas.push(data);
			});
			await pipe(reader, transform);
			strictEqual(datas.length, 1);
			strictEqual(datas[0].length, MB);
		});

		void it('4MB-1 - -1', async () => {
			const reader = new Reader();
			const transform = new SliceStream(4 * MB - 1, -1);
			const datas: Buffer[] = [];
			transform.on('data', (data: Buffer) => {
				datas.push(data);
			});
			await pipe(reader, transform);
			strictEqual(datas.length, 2);
			strictEqual(datas[0].length, 1);
			strictEqual(datas[1].length, MB);
		});

		void it('4MB+1 - -1', async () => {
			const reader = new Reader();
			const transform = new SliceStream(4 * MB + 1, -1);
			const datas: Buffer[] = [];
			transform.on('data', (data: Buffer) => {
				datas.push(data);
			});
			await pipe(reader, transform);
			strictEqual(datas.length, 1);
			strictEqual(datas[0].length, MB - 1);
		});

		void it('4.5MB - -1', async () => {
			const reader = new Reader();
			const transform = new SliceStream(4.5 * MB, -1);
			const datas: Buffer[] = [];
			transform.on('data', (data: Buffer) => {
				datas.push(data);
			});
			await pipe(reader, transform);
			strictEqual(datas.length, 1);
			strictEqual(datas[0].length, 0.5 * MB);
		});

		void it('0.5MB - -1', async () => {
			const reader = new Reader();
			const transform = new SliceStream(0.5 * MB, -1);
			const datas: Buffer[] = [];
			transform.on('data', (data: Buffer) => {
				datas.push(data);
			});
			await pipe(reader, transform);
			strictEqual(datas.length, 5);
			strictEqual(datas[0].length, 0.5 * MB);
			strictEqual(datas[1].length, MB);
			strictEqual(datas[2].length, MB);
			strictEqual(datas[3].length, MB);
			strictEqual(datas[4].length, MB);
		});
	});

	void describe('EmptyStream', () => {
		void it('no data', async () => {
			let datas = 0;
			await new Promise((resolve, reject) => {
				const s = new EmptyStream();
				s.on('data', () => {
					datas++;
				});
				s.once('close', resolve);
				s.once('error', reject);
			});
			strictEqual(datas, 0);
		});
	});
});
