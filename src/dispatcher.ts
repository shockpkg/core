/**
 * Event dispatcher.
 */
export class Dispatcher<T> {
	/**
	 * Event context.
	 */
	protected readonly _context: any;

	/**
	 * Event handlers.
	 */
	protected readonly _handlers = new Set<(event: T) => any>();

	/**
	 * Event dispatcher constructor.
	 *
	 * @param context Context object.
	 */
	constructor(context: any) {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		this._context = context;
	}

	/**
	 * Add listener.
	 *
	 * @param handler Event handler.
	 */
	public on(handler: (event: T) => any) {
		this._handlers.add(handler);
	}

	/**
	 * Remove listener.
	 *
	 * @param handler Event handler.
	 */
	public off(handler: (event: T) => any) {
		this._handlers.delete(handler);
	}

	/**
	 * Trigger, sync.
	 *
	 * @param event Event data.
	 * @returns Handler count.
	 */
	public triggerSync(event: T) {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		const self = this._context;
		let i = 0;
		for (const cb of this._handlers) {
			cb.call(self, event);
			i++;
		}
		return i;
	}

	/**
	 * Trigger, async.
	 *
	 * @param event Event data.
	 * @returns Handler count.
	 */
	public async triggerAsync(event: T) {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		const self = this._context;
		let i = 0;
		for (const cb of this._handlers) {
			// eslint-disable-next-line no-await-in-loop
			await cb.call(self, event);
			i++;
		}
		return i;
	}

	/**
	 * Trigger or throw, sync.
	 *
	 * @param event Event data.
	 */
	public triggerOrThrowSync(event: T) {
		// eslint-disable-next-line no-sync
		if (!this.triggerSync(event)) {
			throw event;
		}
	}

	/**
	 * Trigger or throw, sync.
	 *
	 * @param event Event data.
	 * @returns Handler count.
	 */
	public async triggerOrThrowAsync(event: T) {
		if (!(await this.triggerAsync(event))) {
			throw event;
		}
	}
}
