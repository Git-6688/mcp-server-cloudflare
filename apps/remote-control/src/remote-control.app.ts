import OAuthProvider from '@cloudflare/workers-oauth-provider'
import { McpAgent } from 'agents/mcp'

import { handleApiTokenMode, isApiTokenRequest } from '@repo/mcp-common/src/api-token-mode'
import {
	createAuthHandlers,
	handleTokenExchangeCallback,
} from '@repo/mcp-common/src/cloudflare-oauth-handler'
import { getUserDetails, UserDetails } from '@repo/mcp-common/src/durable-objects/user_details.do'
import { getEnv } from '@repo/mcp-common/src/env'
import { getProps } from '@repo/mcp-common/src/get-props'
import { RequiredScopes } from '@repo/mcp-common/src/scopes'
import { CloudflareMCPServer } from '@repo/mcp-common/src/server'
import { registerAccountTools } from '@repo/mcp-common/src/tools/account.tools'

import { MetricsTracker } from '@repo/mcp-observability'
import { registerRemoteControlTools } from './tools/remote-control.tools'

import type { AuthProps } from '@repo/mcp-common/src/cloudflare-oauth-handler'
import type { Env } from './remote-control.context'

const env = getEnv<Env>()

export { UserDetails }

const metrics = new MetricsTracker(env.MCP_METRICS, {
	name: env.MCP_SERVER_NAME,
	version: env.MCP_SERVER_VERSION,
})

type Props = AuthProps
type State = { activeAccountId: string | null }

export class RemoteControlMCP extends McpAgent<Env, State, Props> {
	_server: CloudflareMCPServer | undefined
	set server(server: CloudflareMCPServer) {
		this._server = server
	}
	get server(): CloudflareMCPServer {
		if (!this._server) {
			throw new Error('Tried to access server before it was initialized')
		}

		return this._server
	}

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env)
	}

	async init() {
		const props = getProps(this)
		const userId = props.type === 'user_token' ? props.user.id : undefined

		this.server = new CloudflareMCPServer({
			userId,
			wae: this.env.MCP_METRICS,
			serverInfo: {
				name: this.env.MCP_SERVER_NAME,
				version: this.env.MCP_SERVER_VERSION,
			},
		})

		registerAccountTools(this)
		registerRemoteControlTools(this)
	}

	async getActiveAccountId() {
		try {
			const props = getProps(this)
			if (props.type === 'account_token') {
				return props.account.id
			}
			const userDetails = getUserDetails(env, props.user.id)
			return await userDetails.getActiveAccountId()
		} catch (e) {
			this.server.recordError(e)
			return null
		}
	}

	async setActiveAccountId(accountId: string) {
		try {
			const props = getProps(this)
			if (props.type === 'account_token') {
				return
			}
			const userDetails = getUserDetails(env, props.user.id)
			await userDetails.setActiveAccountId(accountId)
		} catch (e) {
			this.server.recordError(e)
		}
	}
}

const RemoteControlScopes = {
	...RequiredScopes,
	'account:read': 'See your account info such as account details, analytics, and memberships.',
	'account:write': 'Grants write level access to Account.',
	'workers:write': 'Grants read and write access to Workers and Worker metadata.',
	'r2:write': 'Grants read and write access to R2 storage.',
	'd1:write': 'Grants read and write access to D1 databases.',
	'zone:read': 'Grants read access to Zones.',
} as const

export default {
	fetch: async (req: Request, env: Env, ctx: ExecutionContext) => {
		if (await isApiTokenRequest(req, env)) {
			return await handleApiTokenMode(RemoteControlMCP, req, env, ctx)
		}

		return new OAuthProvider({
			apiHandlers: {
				'/mcp': RemoteControlMCP.serve('/mcp'),
				'/sse': RemoteControlMCP.serveSSE('/sse'),
			},
			defaultHandler: createAuthHandlers({ scopes: RemoteControlScopes, metrics }),
			authorizeEndpoint: '/oauth/authorize',
			tokenEndpoint: '/token',
			tokenExchangeCallback: (options) =>
				handleTokenExchangeCallback(
					options,
					env.CLOUDFLARE_CLIENT_ID,
					env.CLOUDFLARE_CLIENT_SECRET
				),
			accessTokenTTL: 3600,
			refreshTokenTTL: 2592000,
			resourceMatchOriginOnly: true,
			clientRegistrationEndpoint: '/register',
		}).fetch(req, env, ctx)
	},
}
