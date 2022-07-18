import {Server} from 'http';

import express from 'express';

/**
 * Create an HTTP server on a random port for testing.
 *
 * @returns Server details.
 */
export async function createServer() {
	const protocol = 'http:';
	const hostname = '127.0.0.1';
	let errors = false;

	const app = express();
	let host = '';

	const server = await new Promise<Server>((resolve, reject) => {
		let inited = false;
		app.on('error', err => {
			errors = true;
			if (inited) {
				// eslint-disable-next-line no-console
				console.error(err);
				return;
			}
			inited = true;
			reject(err);
		});
		const server = app.listen(0, () => {
			if (inited) {
				return;
			}
			inited = true;
			resolve(server);
		});
	});

	const address = server.address();
	// eslint-disable-next-line no-nested-ternary
	let port = null;
	if (typeof address === 'string') {
		port = Number(address.split('//')[1].split('/')[0].split(':').pop());
	} else if (address) {
		({port} = address);
	}
	if (!port) {
		// eslint-disable-next-line @typescript-eslint/restrict-template-expressions
		throw new Error(`Failed to get port from ${address}`);
	}
	host = `${hostname}:${port}`;
	const url = `${protocol}//${host}`;

	const close = async () => {
		await new Promise<void>(resolve => {
			server.close(() => {
				resolve();
			});
		});
		if (errors) {
			throw new Error('Server throw errors while serving requests');
		}
	};

	return {
		app,
		server,
		protocol,
		hostname,
		host,
		port,
		url,
		close
	};
}
