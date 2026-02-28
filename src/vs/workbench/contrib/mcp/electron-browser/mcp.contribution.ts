import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { mcpDiscoveryRegistry } from '../common/discovery/mcpDiscovery.js';
import { IWorkbenchMcpGatewayService } from '../common/mcpGatewayService.js';
import { IMcpDevModeDebugging } from '../common/mcpDevMode.js';
import { McpDevModeDebuggingNode } from './mcpDevModeDebuggingNode.js';
import { NativeMcpDiscovery } from './nativeMpcDiscovery.js';
import { WorkbenchMcpGatewayService } from './mcpGatewayService.js';

mcpDiscoveryRegistry.register(new SyncDescriptor(NativeMcpDiscovery));
registerSingleton(IMcpDevModeDebugging, McpDevModeDebuggingNode, InstantiationType.Delayed);
registerSingleton(IWorkbenchMcpGatewayService, WorkbenchMcpGatewayService, InstantiationType.Delayed);
