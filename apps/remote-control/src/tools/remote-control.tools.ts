import { z } from 'zod'

import { fetchCloudflareApi, getCloudflareClient } from '@repo/mcp-common/src/cloudflare-api'
import { getProps } from '@repo/mcp-common/src/get-props'

import type { RemoteControlMCP } from '../remote-control.app'

const MISSING_ACCOUNT_ID_RESPONSE = {
	content: [
		{
			type: 'text',
			text: 'No currently active accountId. Try listing your accounts (accounts_list) and then setting an active account (set_active_account)',
		},
	],
}

const zApiResponse = z.object({
	success: z.boolean(),
	errors: z.array(z.unknown()).optional(),
	messages: z.array(z.unknown()).optional(),
})

function wrapApiCall<T extends z.ZodTypeAny>(schema: T) {
	return zApiResponse.extend({ result: schema })
}

export function registerRemoteControlTools(agent: RemoteControlMCP) {
	agent.server.tool(
		'rc_workers_list',
		`List all Workers in your Cloudflare account.

		This tool returns at most the first 100 workers.
		`,
		{},
		{
			title: 'List Workers',
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
			},
		},
		async () => {
			const accountId = await agent.getActiveAccountId()
			if (!accountId) {
				return MISSING_ACCOUNT_ID_RESPONSE
			}

			try {
				const props = getProps(agent)
				const client = getCloudflareClient(props.accessToken)
				const results = await client.workers.scripts.list({ account_id: accountId })

				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify({
								workers: results,
								count: results.length,
							}),
						},
					],
				}
			} catch (e) {
				agent.server.recordError(e)
				return {
					content: [
						{
							type: 'text',
							text: `Error listing workers: ${e instanceof Error && e.message}`,
						},
					],
				}
			}
		}
	)

	agent.server.tool(
		'rc_worker_deploy',
		`Deploy or update a Cloudflare Worker.

		Provide the scriptName and scriptContent to deploy.
		The scriptContent should be valid JavaScript/TypeScript Worker code.

		Note: This deploys/updates the main script only.
		`,
		{
			scriptName: z
				.string()
				.min(1)
				.max(63)
				.describe('The name of the worker script to deploy'),
			scriptContent: z.string().describe('The Worker script content to deploy'),
			module: z
				.boolean()
				.default(true)
				.optional()
				.describe('If true, deploys as ES module format; otherwise classic format'),
		},
		{
			title: 'Deploy Worker',
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
			},
		},
		async (params) => {
			const accountId = await agent.getActiveAccountId()
			if (!accountId) {
				return MISSING_ACCOUNT_ID_RESPONSE
			}

			try {
				const props = getProps(agent)
				const client = getCloudflareClient(props.accessToken)

				const contentType = params.module
					? 'application/javascript+module'
					: 'application/javascript'

				const result = (await client.post(
					`/accounts/${accountId}/workers/scripts/${params.scriptName}`,
					{
						body: params.scriptContent,
						headers: {
							'Content-Type': contentType,
						},
					}
				)) as { success: boolean; result?: { id: string; available_on_subdomain: boolean } }

				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify({
								success: result.success,
								scriptId: result.result?.id,
							}),
						},
					],
				}
			} catch (e) {
				agent.server.recordError(e)
				return {
					content: [
						{
							type: 'text',
							text: `Error deploying worker: ${e instanceof Error && e.message}`,
						},
					],
				}
			}
		}
	)

	agent.server.tool(
		'rc_worker_delete',
		`Delete a Cloudflare Worker.

		Warning: This permanently deletes the Worker and cannot be undone.
		`,
		{
			scriptName: z.string().min(1).describe('The name of the worker script to delete'),
		},
		{
			title: 'Delete Worker',
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
			},
		},
		async (params) => {
			const accountId = await agent.getActiveAccountId()
			if (!accountId) {
				return MISSING_ACCOUNT_ID_RESPONSE
			}

			try {
				const props = getProps(agent)
				const client = getCloudflareClient(props.accessToken)
				const result = await client.workers.scripts.delete(params.scriptName, {
					account_id: accountId,
				})

				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify(result),
						},
					],
				}
			} catch (e) {
				agent.server.recordError(e)
				return {
					content: [
						{
							type: 'text',
							text: `Error deleting worker: ${e instanceof Error && e.message}`,
						},
					],
				}
			}
		}
	)

	agent.server.tool(
		'rc_d1_databases_list',
		`List all D1 databases in your Cloudflare account.`,
		{},
		{
			title: 'List D1 databases',
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
			},
		},
		async () => {
			const accountId = await agent.getActiveAccountId()
			if (!accountId) {
				return MISSING_ACCOUNT_ID_RESPONSE
			}

			try {
				const props = getProps(agent)
				const client = getCloudflareClient(props.accessToken)
				const result = await client.d1.database.list({ account_id: accountId })

				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify({
								databases: result,
								count: result.length,
							}),
						},
					],
				}
			} catch (e) {
				agent.server.recordError(e)
				return {
					content: [
						{
							type: 'text',
							text: `Error listing D1 databases: ${e instanceof Error && e.message}`,
						},
					],
				}
			}
		}
	)

	agent.server.tool(
		'rc_d1_query',
		`Execute a SQL query on a D1 database.

		Provide the databaseId and the SQL query to execute.
		Supports SELECT, INSERT, UPDATE, DELETE, CREATE TABLE, etc.
		`,
		{
			databaseId: z.string().min(1).describe('The ID of the D1 database'),
			sql: z.string().min(1).describe('The SQL query to execute'),
			params: z
				.array(z.unknown())
				.optional()
				.describe('Optional array of parameters for parameterized queries'),
		},
		{
			title: 'Execute D1 query',
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
			},
		},
		async (params) => {
			const accountId = await agent.getActiveAccountId()
			if (!accountId) {
				return MISSING_ACCOUNT_ID_RESPONSE
			}

			try {
				const props = getProps(agent)
				const client = getCloudflareClient(props.accessToken)
				const result = await client.d1.database.query(params.databaseId, params.sql, {
					account_id: accountId,
					params: params.params,
				})

				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify({
								results: result,
							}),
						},
					],
				}
			} catch (e) {
				agent.server.recordError(e)
				return {
					content: [
						{
							type: 'text',
							text: `Error executing D1 query: ${e instanceof Error && e.message}`,
						},
					],
				}
			}
		}
	)

	agent.server.tool(
		'rc_r2_buckets_list',
		`List all R2 storage buckets in your Cloudflare account.`,
		{},
		{
			title: 'List R2 buckets',
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
			},
		},
		async () => {
			const accountId = await agent.getActiveAccountId()
			if (!accountId) {
				return MISSING_ACCOUNT_ID_RESPONSE
			}

			try {
				const props = getProps(agent)
				const client = getCloudflareClient(props.accessToken)
				const result = await client.r2.buckets.list({ account_id: accountId })

				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify({
								buckets: result,
								count: result.length,
							}),
						},
					],
				}
			} catch (e) {
				agent.server.recordError(e)
				return {
					content: [
						{
							type: 'text',
							text: `Error listing R2 buckets: ${e instanceof Error && e.message}`,
						},
					],
				}
			}
		}
	)

	agent.server.tool(
		'rc_kv_namespaces_list',
		`List all KV namespaces in your Cloudflare account.`,
		{},
		{
			title: 'List KV namespaces',
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
			},
		},
		async () => {
			const accountId = await agent.getActiveAccountId()
			if (!accountId) {
				return MISSING_ACCOUNT_ID_RESPONSE
			}

			try {
				const props = getProps(agent)
				const client = getCloudflareClient(props.accessToken)
				const result = await client.kv.namespaces.list({ account_id: accountId })

				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify({
								namespaces: result,
								count: result.length,
							}),
						},
					],
				}
			} catch (e) {
				agent.server.recordError(e)
				return {
					content: [
						{
							type: 'text',
							text: `Error listing KV namespaces: ${e instanceof Error && e.message}`,
						},
					],
				}
			}
		}
	)

	agent.server.tool(
		'rc_zones_list',
		`List all zones in your Cloudflare account.`,
		{},
		{
			title: 'List Zones',
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
			},
		},
		async () => {
			const accountId = await agent.getActiveAccountId()
			if (!accountId) {
				return MISSING_ACCOUNT_ID_RESPONSE
			}

			try {
				const props = getProps(agent)
				const client = getCloudflareClient(props.accessToken)
				const result = await client.zones.list({ account: accountId })

				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify({
								zones: result,
								count: result.length,
							}),
						},
					],
				}
			} catch (e) {
				agent.server.recordError(e)
				return {
					content: [
						{
							type: 'text',
							text: `Error listing zones: ${e instanceof Error && e.message}`,
						},
					],
				}
			}
		}
	)

	agent.server.tool(
		'rc_dns_records_list',
		`List DNS records for a specific zone.

		Provide the zoneId to list all DNS records for that zone.
		`,
		{
			zoneId: z.string().min(1).describe('The ID of the zone'),
		},
		{
			title: 'List DNS records',
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
			},
		},
		async (params) => {
			try {
				const props = getProps(agent)
				const client = getCloudflareClient(props.accessToken)
				const result = await client.dns.records.list({ zone_id: params.zoneId })

				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify({
								records: result,
								count: result.length,
							}),
						},
					],
				}
			} catch (e) {
				agent.server.recordError(e)
				return {
					content: [
						{
							type: 'text',
							text: `Error listing DNS records: ${e instanceof Error && e.message}`,
						},
					],
				}
			}
		}
	)

	agent.server.tool(
		'rc_dns_record_create',
		`Create a new DNS record in a zone.

		Provide the zoneId, record type, name, and content to create a DNS record.
		`,
		{
			zoneId: z.string().min(1).describe('The ID of the zone'),
			type: z
				.enum(['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'SRV', 'CAA', 'PTR'])
				.describe('The DNS record type'),
			name: z.string().min(1).describe('The DNS record name'),
			content: z.string().min(1).describe('The DNS record content'),
			ttl: z.number().int().positive().default(1).describe('TTL in seconds'),
			proxied: z.boolean().optional().describe('Whether the record is proxied by Cloudflare'),
		},
		{
			title: 'Create DNS record',
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
			},
		},
		async (params) => {
			try {
				const props = getProps(agent)
				const client = getCloudflareClient(props.accessToken)
				const result = await client.dns.records.create({
					zone_id: params.zoneId,
					type: params.type,
					name: params.name,
					content: params.content,
					ttl: params.ttl,
					proxied: params.proxied,
				})

				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify({
								success: true,
								record: result,
							}),
						},
					],
				}
			} catch (e) {
				agent.server.recordError(e)
				return {
					content: [
						{
							type: 'text',
							text: `Error creating DNS record: ${e instanceof Error && e.message}`,
						},
					],
				}
			}
		}
	)

	agent.server.tool(
		'rc_dns_record_delete',
		`Delete a DNS record from a zone.

		Warning: This permanently deletes the DNS record.
		`,
		{
			zoneId: z.string().min(1).describe('The ID of the zone'),
			recordId: z.string().min(1).describe('The ID of the DNS record to delete'),
		},
		{
			title: 'Delete DNS record',
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
			},
		},
		async (params) => {
			try {
				const props = getProps(agent)
				const client = getCloudflareClient(props.accessToken)
				await client.dns.records.delete(params.recordId, { zone_id: params.zoneId })

				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify({
								success: true,
								message: 'DNS record deleted successfully',
							}),
						},
					],
				}
			} catch (e) {
				agent.server.recordError(e)
				return {
					content: [
						{
							type: 'text',
							text: `Error deleting DNS record: ${e instanceof Error && e.message}`,
						},
					],
				}
			}
		}
	)

	agent.server.tool(
		'rc_account_summary',
		`Get a summary of your Cloudflare account.

		Returns account details, subscription information, and memberships.
		`,
		{},
		{
			title: 'Account Summary',
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
			},
		},
		async () => {
			const accountId = await agent.getActiveAccountId()
			if (!accountId) {
				return MISSING_ACCOUNT_ID_RESPONSE
			}

			try {
				const props = getProps(agent)
				const data = await fetchCloudflareApi({
					endpoint: '',
					accountId,
					apiToken: props.accessToken,
				})

				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify({
								account: data,
							}),
						},
					],
				}
			} catch (e) {
				agent.server.recordError(e)
				return {
					content: [
						{
							type: 'text',
							text: `Error getting account summary: ${e instanceof Error && e.message}`,
						},
					],
				}
			}
		}
	)

	agent.server.tool(
		'rc_api_execute',
		`Execute a custom Cloudflare API request.

		This allows you to call any Cloudflare API endpoint.
		The method defaults to GET. Set method to POST, PUT, PATCH, or DELETE for write operations.

		Example:
		- endpoint: "/workers/scripts"
		- method: "GET"
		`,
		{
			endpoint: z.string().min(1).describe('The API endpoint path (e.g., "/workers/scripts")'),
			method: z
				.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
				.default('GET')
				.describe('HTTP method to use'),
			body: z.unknown().optional().describe('Optional request body for POST/PUT/PATCH'),
			zoneLevel: z
				.boolean()
				.default(false)
				.optional()
				.describe('If true, calls the zone-level API instead of account-level'),
			zoneId: z.string().optional().describe('Required if zoneLevel is true'),
		},
		{
			title: 'Execute API request',
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
			},
		},
		async (params) => {
			const accountId = await agent.getActiveAccountId()
			if (!accountId && !params.zoneLevel) {
				return MISSING_ACCOUNT_ID_RESPONSE
			}

			try {
				const props = getProps(agent)
				const client = getCloudflareClient(props.accessToken)

				let result: unknown

				if (params.zoneLevel) {
					if (!params.zoneId) {
						return {
							content: [
								{
									type: 'text',
									text: 'zoneId is required for zone-level API requests',
								},
							],
						}
					}

					const baseUrl = `https://api.cloudflare.com/client/v4/zones/${params.zoneId}`
					const finalUrl = `${baseUrl}${params.endpoint}`
					const response = await fetch(finalUrl, {
						method: params.method,
						headers: {
							Authorization: `Bearer ${props.accessToken}`,
							'Content-Type': 'application/json',
						},
						body: params.body ? JSON.stringify(params.body) : undefined,
					})

					result = await response.json()
				} else {
					result = await (client as unknown as {
						fetch: (url: string, init: RequestInit) => Promise<unknown>
					}).fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}${params.endpoint}`, {
						method: params.method,
						headers: {
							'Content-Type': 'application/json',
						},
						body: params.body ? JSON.stringify(params.body) : undefined,
					})
				}

				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify(result),
						},
					],
				}
			} catch (e) {
				agent.server.recordError(e)
				return {
					content: [
						{
							type: 'text',
							text: `Error executing API request: ${e instanceof Error && e.message}`,
						},
					],
				}
			}
		}
	)
}
