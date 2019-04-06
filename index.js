const modules = require('./modules')

const defaults = {
	name: '123 TV',
	prefix: '123tv_',
	host: 'http://123tvnow.com',
	icon: 'http://123tvnow.com/wp-content/themes/123tv/img/logo.png'
}

const channels = require('./channels').map(el => {
	el.type = 'tv'
	el.posterShape = 'landscape'
	el.background = el.poster.replace(/-[0-9]+x[0-9]+/g,'')
	el.logo = el.poster
	el.id = defaults.prefix + el.id
	return el
})

function btoa(str) {
    var buffer;

    if (str instanceof Buffer) {
      buffer = str;
    } else {
      buffer = Buffer.from(str.toString(), 'binary');
    }

    return buffer.toString('base64');
}

function atob(str) {
    return Buffer.from(str, 'base64').toString('binary');
}

const cache = {}

module.exports = {
	manifest: local => {
		modules.set(local.modules)

		const hostParts = config.host.match(/^[\w-]+:\/{2,}\[?[\w\.:-]+\]?(?::[0-9]*)?/i)

		let host

		if ((hostParts || []).length)
			host = hostParts[0]
		else
			host = defaults.host

		return Promise.resolve({
			id: 'org.' + defaults.name.toLowerCase().replace(/[^a-z]+/g,''),
			version: '1.0.0',
			name: defaults.name,
			description: 'Free IPTV from 123tv',
			resources: ['stream', 'meta', 'catalog'],
			types: ['tv', 'channel'],
			idPrefixes: [defaults.prefix],
			icon: defaults.icon.replace(defaults.host, host),
			catalogs: [
				{
					id: defaults.prefix + 'cat',
					name: 'M3U Playlists',
					type: 'tv',
					extra: [{ name: 'search' }]
				}
			]
		})
	},
	handler: (args, local) => {
		modules.set(local.modules)
		const persist = local.persist
		const config = local.config
		const proxy = modules.get.internal.proxy
		const extra = args.extra || {}

		const hostParts = config.host.match(/^[\w-]+:\/{2,}\[?[\w\.:-]+\]?(?::[0-9]*)?/i)

		let host

		if ((hostParts || []).length)
			host = hostParts[0]
		else
			host = defaults.host

	    if (!args.id)
	        return Promise.reject(new Error(defaults.name + ' - No ID Specified'))

		return new Promise((resolve, reject) => {

			if (args.resource == 'catalog') {
				const extra = args.extra || {}
				if (extra.search) {
					const results = []
					channels.forEach(meta => {
						if (meta.name.toLowerCase().includes(extra.search.toLowerCase()))
							results.push(meta)
					})
					if (results.length)
						resolve({ metas: results })
					else
						reject(defaults.name + ' - No search results for: ' + extra.search)

				} else
					resolve({ metas: channels })

			} else if (args.resource == 'meta') {
				let meta
				channels.some(chan => {
					if (chan.id == args.id) {
						meta = chan
						return true
					}
				})
				if (meta)
					resolve({ meta })
				else
					reject(defaults.name + ' - Could not get meta for id: ' + args.id)
			} else if (args.resource == 'stream') {
				if (cache[args.id]) {
					resolve(cache[args.id])
					return
				}
				let meta
				channels.some(chan => {
					if (chan.id == args.id) {
						meta = chan
						return true
					}
				})
				if (meta) {
					const imgOrig = meta.poster.replace(/-[0-9]+x[0-9]+/g,'')
					const payload = btoa(meta.name + '||' + imgOrig)
					const headers = {
						'origin': host,
						'referer': meta.href.replace(defaults.host, host),
						'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3683.86 Safari/537.36'
					}
					modules.get.needle.get(meta.href, { headers }, (err, resp, body) => {
						if (!err && body) {
							const matches = body.match(/atob\('[^']+'\)/g)
							if ((matches || [])[0]) {
								const url = atob(matches[0].substr(6).slice(0, -2)) + '?1&json=' + payload
								modules.get.needle.get(url, { headers }, (err, resp, body) => {
									if (!err && body && Array.isArray(body) && body.length) {
										const results = body.map(el => { return { title: el.title || el.type || 'Stream', url: el.file } })
										if (results.length) {
											const streams = []
											const q = modules.get.async.queue((task, cb) => {
												modules.get.needle.get(task.url, { headers }, (err, resp, body) => {
													if (!err && body) {
														const m3u = modules.get['m3u8-reader']
														let playlist
														try {
															playlist = m3u(body)
														} catch(e) {
															console.error(e)
														}
														if (playlist && playlist.length) {
															const urls = []
															playlist.forEach(line => {
																if (typeof line == 'string' && (line.endsWith('.m3u') || line.endsWith('.m3u8')))
																	urls.push(line)
															})
															if (urls.length) {
																urls.forEach(el => {
																	if (!el.includes('://'))
																		el = task.url.substr(0, task.url.lastIndexOf("/") +1) + el
																	streams.push({ title: task.title, url: proxy.addProxy(el, { headers }) })
																})
															} else {
																task.url = proxy.addProxy(task.url, { headers })
																streams.push(task)
															}
														}
													} else if (err)
														console.error(err)
													cb()
												})
											}, 1)
											q.drain = () => {
												if (streams.length)
													resolve({ streams })
												else
													reject(defaults.name + ' - No valid stream URLs from API')
											}
											results.forEach(result => { q.push(result) })
										} else
											reject(defaults.name + ' - Got empty array of stream URLs from API')
									} else
										reject(defaults.name + ' - Could not extract stream URL from API')
								})
							} else
								reject(defaults.name + ' - Could not extract API URL with REGEX')
						} else
							reject(defaults.name + ' - Could not extract API URL')
					})
				} else
					reject(defaults.name + ' - Could not get stream for id: ' + args.id)
			}
		})
	}
}
