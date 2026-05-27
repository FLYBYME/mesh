import type { ILogger  } from './ILogger';
import type { IServiceBroker  } from './IServiceBroker';
import type { IMeshApp  } from './IMeshApp';

// Inferred interface for life-cycle hooks of modules within MeshApp.
export interface IMeshModule {
  readonly name: string;
  logger?: ILogger | undefined;
  serviceBroker?: IServiceBroker | undefined;
  dependencies?: string[] | undefined;

  /** Initializes the module. Called before starting. */
  onInit?(app: IMeshApp): Promise<void> | void;
  /** Starts the module's services and operations. */
  onStart?(app: IMeshApp): Promise<void> | void;
  /** Stops the module's services and operations gracefully. */
  onStop?(app: IMeshApp): Promise<void> | void;
  /** Called after all modules have started, indicating readiness. */
  onReady?(app: IMeshApp): Promise<void> | void;
}
