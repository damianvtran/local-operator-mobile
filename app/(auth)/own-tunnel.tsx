import OwnTunnel from "@/features/auth/own-tunnel";

/**
 * The self-hosted path (F-11, and F-3's address + password step): the commands to
 * run, the address and password, and a real connection test before anything is
 * saved. No Radient account is reachable from here, on purpose.
 */
export default OwnTunnel;
