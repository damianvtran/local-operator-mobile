/**
 * A `RouteProfile` → a configured relay client.
 *
 * NOT IMPLEMENTED. The connection stream owns this file. It is the single place
 * that turns a route into a client, so a screen never assembles headers and a
 * second route cannot grow a second header policy by accident.
 */
export {};
