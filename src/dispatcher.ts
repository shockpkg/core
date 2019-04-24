import {property} from './decorators';

/**
 * Event dispatcher.
 *
 * @param context Context object.
 */
export class Dispatcher<T> extends Object {

	/**
	 * Event context.
	 */
	@property(false)
	protected readonly _context: any;

	/**
	 * Event handlers.
	 */
	@property(false)
	protected readonly _handlers = new Set<(event: T) => any>();

	constructor(context: any) {
		super();

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
	 * @param handler Event data.
	 * @return Handler count.
	 */
	public triggerSync(event: T) {
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
	 * @param handler Event data.
	 * @return Handler count.
	 */
	public async triggerAsync(event: T) {
		const self = this._context;
		let i = 0;
		for (const cb of this._handlers) {
			await cb.call(self, event);
			i++;
		}
		return i;
	}

	/**
	 * Trigger or throw, sync.
	 *
	 * @param handler Event data.
	 * @return Handler count.
	 */
	public triggerOrThrowSync(event: T) {
		if (!this.triggerSync(event)) {
			throw event;
		}
	}

	/**
	 * Trigger or throw, sync.
	 *
	 * @param handler Event data.
	 * @return Handler count.
	 */
	public async triggerOrThrowAsync(event: T) {
		if (!await this.triggerAsync(event)) {
			throw event;
		}
	}
}
