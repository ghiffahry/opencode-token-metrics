import argparse
import time
import common

def main():
    ap = argparse.ArgumentParser(description="Stop the Token Metrics bridge")
    ap.add_argument("--port", type=int, default=common.DEFAULT_PORT)
    args = ap.parse_args()

    def wait_closed(seconds=4.0):
        deadline = time.time() + seconds
        while time.time() < deadline:
            if not common.port_open(common.DEFAULT_HOST, args.port):
                return True
            time.sleep(0.25)
        return False

    pid = common.read_pid()
    if pid and not common.port_open(common.DEFAULT_HOST, args.port):
        common.clear_pid()
        print("No server listening on port %d; stale PID file removed." % args.port)
        return

    killed = False
    if pid:
        if common.kill_pid(pid):
            killed = True
            common.clear_pid()
        else:
            print("Could not kill PID %d; trying port lookup." % pid)

    if not killed:
        by_port = common.pid_by_port(args.port)
        if by_port:
            print("Killing PID %d (listener on :%d)." % (by_port, args.port))
            common.kill_pid(by_port)

    if wait_closed():
        print("Stopped (port %d closed)." % args.port)
        return

    by_port = common.pid_by_port(args.port)
    if by_port:
        print("Killing PID %d (listener on :%d)." % (by_port, args.port))
        common.kill_pid(by_port)
        if wait_closed():
            print("Stopped (port %d closed)." % args.port)
            return

    print("Port %d is still open. Stop the process manually." % args.port)


if __name__ == "__main__":
    main()
