import {Readable, pipeline} from 'stream';
import {join as pathJoin} from 'path';
import {promisify} from 'util';
import {rm, mkdir, lstat} from 'fs/promises';

import {createWriterStream, StreamSlice} from './stream';

const pipe = promisify(pipeline);

const tmpPath = './spec/tmp';

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

describe('stream', () => {
	describe('createWriterStream', () => {
		beforeEach(async () => {
			await rm(tmpPath, {recursive: true, force: true});
		});

		afterEach(async () => {
			await rm(tmpPath, {recursive: true, force: true});
		});

		it('wrote', async () => {
			await mkdir(tmpPath, {recursive: true});
			const file = pathJoin(tmpPath, 'tmp.bin');
			const reader = new Reader();
			const writer = createWriterStream(file);
			const wrotes: number[] = [];
			writer.on('wrote', () => {
				wrotes.push(writer.bytesWritten);
			});
			await pipe(reader, writer);
			expect((await lstat(file)).size).toBe(5 * MB);
			expect(wrotes).toEqual([MB, 2 * MB, 3 * MB, 4 * MB, 5 * MB]);
		});
	});

	describe('StreamSlice', () => {
		it('2MB - 10b', async () => {
			const reader = new Reader();
			const transform = new StreamSlice(2 * MB, 10);
			const datas: number[][] = [];
			transform.on('data', (data: Buffer) => {
				datas.push([...data]);
			});
			await pipe(reader, transform);
			expect(datas).toEqual([[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]]);
		});

		it('2MB - 0b', async () => {
			const reader = new Reader();
			const transform = new StreamSlice(2 * MB, 0);
			const datas: number[][] = [];
			transform.on('data', (data: Buffer) => {
				datas.push([...data]);
			});
			await pipe(reader, transform);
			expect(datas).toEqual([]);
		});

		it('2MB+1 - 0b', async () => {
			const reader = new Reader();
			const transform = new StreamSlice(2 * MB + 1, 0);
			const datas: number[][] = [];
			transform.on('data', (data: Buffer) => {
				datas.push([...data]);
			});
			await pipe(reader, transform);
			expect(datas).toEqual([]);
		});

		it('2MB+1 - 10b', async () => {
			const reader = new Reader();
			const transform = new StreamSlice(2 * MB + 1, 10);
			const datas: number[][] = [];
			transform.on('data', (data: Buffer) => {
				datas.push([...data]);
			});
			await pipe(reader, transform);
			expect(datas).toEqual([[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]]);
		});

		it('2MB-1 - 10b', async () => {
			const reader = new Reader();
			const transform = new StreamSlice(2 * MB - 1, 10);
			const datas: number[][] = [];
			transform.on('data', (data: Buffer) => {
				datas.push([...data]);
			});
			await pipe(reader, transform);
			expect(datas).toEqual([[0xff], [0, 1, 2, 3, 4, 5, 6, 7, 8]]);
		});

		it('2MB-4 - 4b', async () => {
			const reader = new Reader();
			const transform = new StreamSlice(2 * MB - 4, 4);
			const datas: number[][] = [];
			transform.on('data', (data: Buffer) => {
				datas.push([...data]);
			});
			await pipe(reader, transform);
			expect(datas).toEqual([[0xfc, 0xfd, 0xfe, 0xff]]);
		});

		it('1.5MB - 2MB', async () => {
			const reader = new Reader();
			const transform = new StreamSlice(1.5 * MB, 2 * MB);
			const datas: Buffer[] = [];
			transform.on('data', (data: Buffer) => {
				datas.push(data);
			});
			await pipe(reader, transform);
			expect(datas.length).toBe(3);
			expect(datas[0].length).toBe(0.5 * MB);
			expect(datas[1].length).toBe(MB);
			expect(datas[2].length).toBe(0.5 * MB);
		});

		it('4MB - -1', async () => {
			const reader = new Reader();
			const transform = new StreamSlice(4 * MB, -1);
			const datas: Buffer[] = [];
			transform.on('data', (data: Buffer) => {
				datas.push(data);
			});
			await pipe(reader, transform);
			expect(datas.length).toBe(1);
			expect(datas[0].length).toBe(MB);
		});

		it('4MB-1 - -1', async () => {
			const reader = new Reader();
			const transform = new StreamSlice(4 * MB - 1, -1);
			const datas: Buffer[] = [];
			transform.on('data', (data: Buffer) => {
				datas.push(data);
			});
			await pipe(reader, transform);
			expect(datas.length).toBe(2);
			expect(datas[0].length).toBe(1);
			expect(datas[1].length).toBe(MB);
		});

		it('4MB+1 - -1', async () => {
			const reader = new Reader();
			const transform = new StreamSlice(4 * MB + 1, -1);
			const datas: Buffer[] = [];
			transform.on('data', (data: Buffer) => {
				datas.push(data);
			});
			await pipe(reader, transform);
			expect(datas.length).toBe(1);
			expect(datas[0].length).toBe(MB - 1);
		});

		it('4.5MB - -1', async () => {
			const reader = new Reader();
			const transform = new StreamSlice(4.5 * MB, -1);
			const datas: Buffer[] = [];
			transform.on('data', (data: Buffer) => {
				datas.push(data);
			});
			await pipe(reader, transform);
			expect(datas.length).toBe(1);
			expect(datas[0].length).toBe(0.5 * MB);
		});

		it('0.5MB - -1', async () => {
			const reader = new Reader();
			const transform = new StreamSlice(0.5 * MB, -1);
			const datas: Buffer[] = [];
			transform.on('data', (data: Buffer) => {
				datas.push(data);
			});
			await pipe(reader, transform);
			expect(datas.length).toBe(5);
			expect(datas[0].length).toBe(0.5 * MB);
			expect(datas[1].length).toBe(MB);
			expect(datas[2].length).toBe(MB);
			expect(datas[3].length).toBe(MB);
			expect(datas[4].length).toBe(MB);
		});
	});
});
