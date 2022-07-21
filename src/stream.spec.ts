import {Readable, pipeline} from 'stream';
import {join as pathJoin} from 'path';
import {promisify} from 'util';
import {rm, mkdir, lstat} from 'fs/promises';

import {createWriterStream} from './stream';

const pipe = promisify(pipeline);

const tmpPath = './spec/tmp';

const MB = 1024 * 1024;

class Reader extends Readable {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	public _read(size: number) {
		for (let i = 0; i < 5; i++) {
			this.push(Buffer.alloc(MB));
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
});
