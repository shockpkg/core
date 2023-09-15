import {describe, it} from 'node:test';
import {ok} from 'node:assert';

import {PACKAGES_URL} from './constants';

void describe('constants', () => {
	void describe('PACKAGES_URL', () => {
		void it('Check URL', () => {
			ok(PACKAGES_URL.startsWith('https://'));
		});
	});
});
