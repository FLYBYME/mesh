export type ServiceState =
    | 'started'
    | 'stopped'
    | 'starting'
    | 'stopping'
    | 'pausing'
    | 'paused'
    | 'errored'
    | 'initializing'
    | 'running';

