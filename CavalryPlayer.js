// Dynamically import the ES6 module
const wasm = await import('/cavalry-demos/wasm-lib/CavalryWasm.js')
// Configure and create the module instance
const module = await wasm.default({
	// Tells the module where to find the wasm files
	locateFile: (path) => `/cavalry-demos/wasm-lib/${path}`,
	// Set info logging function
	print: (text) => console.log(text),
	// Set error logging function
	printErr: (text) => console.error(text),
})

export class CavalryPlayer {
	#animationFrameId = null
	#container = null
	#surface = null
	#controls = null
	#timeline = null
	#playButton = null
	#options = {}
	module = module
	player = null
	canvas = null

	constructor(parent, options = {}) {
		this.#options.autoplay = options.autoplay ?? true
		this.#options.sceneInput = options.sceneInput ?? true
		const canvasId = '#canvas'
		const ui = this.createInterface()
		this.#controls = ui.querySelector('#controls')
		this.#container = ui.querySelector('#container')
		this.#timeline = ui.querySelector('#frameSlider')
		this.canvas = ui.querySelector(canvasId)
		// This allows WASM to find the canvas when it's in shadow DOM
		module.specialHTMLTargets[canvasId] = this.canvas
		this.canvas.addEventListener(
			'webglcontextlost',
			() => this.showPlayerError('WebGL context lost'),
			false,
		)
		// NOTE: Simulate `webglcontextlost` event
		// const gl = this.canvas.getContext('webgl')
		// gl.getExtension('WEBGL_lose_context').loseContext()

		const restartButton = ui.querySelector('#restartButton')
		restartButton?.addEventListener('click', () => this.restart())

		const playButton = ui.querySelector('#playButton')
		playButton?.addEventListener('click', () => this.togglePlayback())
		this.#playButton = playButton

		const prevButton = ui.querySelector('#prevButton')
		prevButton?.addEventListener('click', () => this.prev())

		const nextButton = ui.querySelector('#nextButton')
		nextButton?.addEventListener('click', () => this.next())

		const sceneInput = ui.querySelector('#sceneInput')
		sceneInput?.addEventListener('change', async ({ target }) => {
			const file = target.files[0]
			const contents = await file.arrayBuffer()
			await this.loadScene(new Uint8Array(contents), file.name)
		})

		window.addEventListener('resize', (event) => this.resize(event))
		parent.innerHTML = ''
		parent.appendChild(ui)
	}

	createInterface() {
		const container = document.createElement('div')
		container.className = 'demo-layout'
		container.innerHTML = `
			<div class="viewport-section">
				<div id="container" class="player-container">
					<canvas id="canvas"></canvas>
				</div>
			</div>

			<div class="controls-section">
				${
					this.#options.sceneInput === false
						? ''
						: `<div class="control-group">
						<div class="file-input-wrapper">
							<input type="file" accept=".cv" id="sceneInput" class="file-input" />
							<div class="file-input-button">Load Scene File</div>
						</div>
					</div>`
				}

				<div class="timeline-controls">
					<div>
						<button id="restartButton">⏮</button>
						<button id="playButton">Play</button>
						<button id="prevButton">◀︎</button>
						<button id="nextButton">▶︎</button>
					</div>
					<input type="range" id="frameSlider" value="0" min="0" max="100" step="1" />
				</div>

				<div id="controls" class="dynamic-controls"></div>
			</div>
    `
		return container
	}

	async loadScene(contents, filename = '', assetsPath = '') {
		try {
			if (this.player) {
				this.stop()
			}
			module.FS.writeFile(filename, contents)
			this.player = module.Cavalry.MakeWithPath(filename)
			if (module.pendingAssets?.length) {
				const assets = module.pendingAssets.map((asset) =>
					this.loadPendingAssets(asset, assetsPath),
				)
				await Promise.all(assets)
			}
			this.loadControlCentreAttributes()
			this.setTimelineAttributes()
			this.resize()
			if (this.#options.autoplay) {
				this.play()
			}
		} catch (error) {
			console.error(error)
			this.showPlayerError(error.message)
		}
	}

	setReplaceableAssets(assets = []) {
		if (!this.player) {
			return
		}
		if (!assets.length) {
			this.#controls.innerHTML = `
				<div class="no-controls-message">
					No replaceable assets
				</div>
			`
			return
		}

		const controls = document.createElement('div')
		controls.style.all = 'inherit'

		for (const { assetId, type } of assets) {
			const group = document.createElement('div')
			group.className = 'control-group'

			const label = document.createElement('label')
			label.className = 'control-label'
			group.appendChild(label)

			const control = document.createElement('div')
			control.className = 'file-input-wrapper'
			group.appendChild(control)

			const input = document.createElement('input')
			input.type = 'file'
			input.className = 'file-input'
			control.appendChild(input)

			const button = document.createElement('div')
			button.className = 'file-input-button'
			control.appendChild(button)

			if (type === 'image') {
				button.innerText = 'Choose Image File'
				label.textContent = `Replace Image Asset (${assetId})`
				input.accept = 'image/*'
			}

			if (type === 'csv') {
				button.innerText = 'Choose CSV File'
				label.textContent = `Replace CSV Asset (${assetId})`
				input.accept = '.csv'
			}

			const fontGroup = document.createElement('div')
			fontGroup.className = 'control-group'

			if (type === 'font') {
				button.innerText = 'Choose Font File'
				label.textContent = `Load Custom Font`
				input.accept = '.ttf,.otf,.woff,.woff2'

				fontGroup.appendChild(this.createFontControl())
				controls.appendChild(fontGroup)
			}

			input.addEventListener('change', async ({ target }) => {
				const file = target.files[0]
				if (!file) {
					return
				}
				const { filename, contents } = await this.readFile(file)
				module.FS.writeFile(filename, contents)
				await this.loadAsset({ assetId, filename, type })
				if (file.type.startsWith('font')) {
					fontGroup.innerHTML = ''
					fontGroup.appendChild(this.createFontControl())
				}
			})

			controls.appendChild(group)
		}

		this.#controls.innerHTML = ''
		this.#controls.appendChild(controls)
	}

	createFontControl() {
		const fragment = document.createDocumentFragment()

		const fontLabel = document.createElement('label')
		fontLabel.className = 'control-label'
		fontLabel.innerText = 'Apply Font to Text'
		fragment.appendChild(fontLabel)

		const fontSelect = document.createElement('select')
		fontSelect.id = 'fontFamilySelect'
		fragment.appendChild(fontSelect)

		const styleSelect = document.createElement('select')
		styleSelect.id = 'fontStyleSelect'
		fragment.appendChild(styleSelect)

		const fonts = vectorToArray(this.player.queryFonts())

		for (const font of fonts) {
			const fontOption = document.createElement('option')
			fontOption.innerText = font
			fontSelect.appendChild(fontOption)

			const handleFontChange = (value) => {
				const styles = vectorToArray(this.player.getFontStyles(value))
				styleSelect.innerHTML = ''
				for (const style of styles) {
					const styleOption = document.createElement('option')
					styleOption.innerText = style
					styleSelect.appendChild(styleOption)
				}
				// Hardcoded attributes for Custom Font demo
				for (const layer of ['textShape#1', 'textShape#2']) {
					this.player.setAttributeFont(layer, 'font', {
						font: fontSelect.value,
						style: styleSelect.value,
					})
				}
				if (!this.player.isPlaying()) {
					this.render()
				}
			}
			handleFontChange(font)

			fontSelect.addEventListener('change', ({ target }) => {
				handleFontChange(target.value)
			})
		}

		return fragment
	}

	readFile(file) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader()
			reader.onload = ({ target }) => {
				try {
					const contents = new Uint8Array(target.result)
					const filename = file.name
					resolve({ contents, filename })
				} catch (error) {
					reject(error)
				}
			}
			reader.onerror = () => {
				reject(new Error('Failed to read image file'))
			}
			reader.readAsArrayBuffer(file)
		})
	}

	setEditableAttributes(attributeIds = []) {
		if (!this.player) {
			return
		}
		if (!attributeIds.length) {
			this.#controls.innerHTML = `
				<div class="no-controls-message">
					No editable attributes
				</div>
			`
			return
		}
		const controls = this.createControls(attributeIds)
		this.#controls.innerHTML = ''
		this.#controls.appendChild(controls)
	}

	loadControlCentreAttributes() {
		if (!this.player) {
			return
		}
		const compId = this.player.getActiveComp()
		const attributesPointer = this.player.getControlCentreAttributes(compId)
		const attributeIds = vectorToArray(attributesPointer)
		if (!attributeIds.length) {
			this.#controls.innerHTML = `
				<div class="no-controls-message">
					Control Centre is empty
				</div>
			`
			return
		}
		const controls = this.createControls(attributeIds)
		this.#controls.innerHTML = ''
		this.#controls.appendChild(controls)
	}

	createControls(attributes = []) {
		const controls = document.createElement('div')
		controls.style.all = 'inherit'

		for (const attribute of attributes) {
			const group = document.createElement('div')
			group.className = 'control-group'

			const [layerId, ...attr] = attribute.split('.')
			const attrId = attr.join('.')

			const label = document.createElement('label')
			label.className = 'control-label'
			label.textContent =
				this.player.getAttributeName(layerId, attrId) || attrId
			group.appendChild(label)

			const definition = this.player.getAttributeDefinition(layerId, attrId)
			let value = this.player.getAttribute(layerId, attrId)
			if (Array.isArray(value) && value.length === 2) {
				const [x, y] = value
				value = { x, y }
			}
			if (Array.isArray(value) && value.length === 3) {
				const [x, y, z] = value
				value = { x, y, z }
			}

			const input = this.createControl({
				type: definition.type,
				value: this.player.getAttribute(layerId, attrId),
				limits: definition.numericInfo,
				layerId,
				attrId,
			})
			group.appendChild(input)

			controls.appendChild(group)
		}

		return controls
	}

	createControl({ layerId, attrId, type, value, limits }) {
		if (type === 'int' || type === 'double') {
			const input = document.createElement('input')
			input.type = limits.hasHardMin && limits.hasHardMax ? 'range' : 'number'
			input.className = 'control-input'
			input.defaultValue = value
			input.step = limits.step || type === 'int' ? 1 : 0.1
			// prettier-ignore
			input.min = limits.hasHardMin ? limits.hardMin : limits.hasSoftMin ? limits.softMin : null
			// prettier-ignore
			input.max = limits.hasHardMax ? limits.hardMax : limits.hasSoftMax ? limits.softMax : null
			input.addEventListener('input', ({ target }) => {
				const value =
					type === 'int' ? parseInt(target.value) : parseFloat(target.value)
				this.player.setAttribute(layerId, attrId, value)
				if (!this.player.isPlaying()) {
					this.render()
				}
			})
			return input
		}

		if (type === 'int2' || type === 'double2') {
			const container = document.createElement('div')
			container.className = 'double2-controls'

			const inputX = document.createElement('input')
			inputX.type = 'number'
			inputX.className = 'control-input'
			inputX.placeholder = 'X'
			inputX.step = limits.step || type === 'int2' ? 1 : 0.1
			inputX.defaultValue = value

			const inputY = document.createElement('input')
			inputY.type = 'number'
			inputY.className = 'control-input'
			inputY.placeholder = 'Y'
			inputY.step = limits.step || type === 'int2' ? 1 : 0.1
			inputY.defaultValue = value
			const updateValue = () => {
				const x = parseFloat(inputX.value) || 0
				const y = parseFloat(inputY.value) || 0
				this.player.setAttribute(nodeId, attrId, [x, y])
				if (!this.player.isPlaying()) {
					this.render()
				}
			}
			inputX.addEventListener('change', updateValue)
			inputY.addEventListener('change', updateValue)
			container.appendChild(inputX)
			container.appendChild(inputY)
			return container
		}

		if (type === 'bool') {
			const input = document.createElement('input')
			input.type = 'checkbox'
			input.className = 'control-input'
			input.defaultChecked = value
			input.addEventListener('change', ({ target }) => {
				this.player.setAttribute(layerId, attrId, target.checked)
				if (!this.player.isPlaying()) {
					this.render()
				}
			})
			return input
		}

		if (type === 'string') {
			const input = document.createElement('input')
			input.type = 'text'
			input.className = 'control-input'
			input.defaultValue = value
			input.addEventListener('change', ({ target }) => {
				this.player.setAttribute(layerId, attrId, target.value)
				if (!this.player.isPlaying()) {
					this.render()
				}
			})
			return input
		}

		if (type === 'color') {
			const container = document.createElement('div')
			container.className = 'color-controls'
			const input = document.createElement('input')
			input.type = 'color'
			input.className = 'control-input color-picker'
			const hex = [
				value.r.toString(16).padStart(2, '0'),
				value.g.toString(16).padStart(2, '0'),
				value.b.toString(16).padStart(2, '0'),
			].join('')
			input.defaultValue = `#${hex}`

			const text = document.createElement('input')
			text.type = 'text'
			text.className = 'control-input hex-input'
			text.placeholder = '#ffffff'
			text.maxLength = 7
			text.defaultValue = `#${hex}`

			const handleInput = ({ target }) => {
				const hex = target.value.replace('#', '')
				if (hex.length !== 6) {
					return
				}
				input.value = `#${hex}`
				text.value = `#${hex}`
				const r = parseInt(hex.slice(0, 2), 16)
				const g = parseInt(hex.slice(2, 4), 16)
				const b = parseInt(hex.slice(4, 6), 16)
				const newValue = { r, g, b, a: value.a ?? 255 }
				this.player.setAttribute(layerId, attrId, newValue)
				if (!this.player.isPlaying()) {
					this.render()
				}
			}
			input.addEventListener('input', handleInput)
			text.addEventListener('input', handleInput)
			container.appendChild(input)
			container.appendChild(text)
			return container
		}

		if (type === 'richText') {
			const input = document.createElement('textarea')
			input.placeholder = 'Enter your text here...'
			input.rows = 3
			input.defaultValue = value
			input.addEventListener('input', ({ target }) => {
				this.player.setAttribute(layerId, attrId, target.value)
				if (!this.player.isPlaying()) {
					this.render()
				}
			})
			return input
		}

		const span = document.createElement('span')
		span.className = 'control-info'
		span.innerText = `Unsupported type '${type}'`
		return span
	}

	async loadPendingAssets(data, dir) {
		const response = await fetch(`${dir}/${data.filename}`)
		if (!response.ok) {
			throw new Error(`Failed to fetch scene: ${response.statusText}`)
		}
		const asset = await response.arrayBuffer()
		module.FS.writeFile(data.filename, new Uint8Array(asset))
		await this.loadAsset(data)
	}

	async loadAsset(data) {
		const { assetId, filename, type } = data
		switch (type) {
			case 'image':
				this.player.replaceImageAsset(filename, assetId)
				break
			case 'font':
				module.loadFont(filename, assetId)
				this.player.replaceFontAsset(filename, assetId)
				break
			case 'csv':
				this.player.replaceCSVAsset(filename, assetId)
				break
			case 'svg':
				this.player.replaceSVGAsset(filename, assetId)
				break
			case 'excel':
				this.player.replaceExcelAsset(filename, assetId)
				break
			case 'googlesheet':
				this.player.replaceGoogleSheet(filename, assetId)
				break
			default:
				console.warn(
					`Unexpected asset type "${type}" for ${assetId} (${filename})`,
				)
				return
		}
	}

	resize() {
		if (!this.player) {
			return
		}

		const scene = this.player.getSceneResolution()
		const parent = this.canvas.parentElement

		this.canvas.width = 0
		this.canvas.height = 0

		const scaleX = parent.offsetWidth / scene.width
		const scaleY = parent.offsetHeight / scene.height
		const scale = Math.min(scaleX, scaleY)
		const width = scene.width * scale
		const height = scene.height * scale

		this.canvas.width = width
		this.canvas.height = height

		this.#surface = module.makeWebGLSurfaceFromElement(
			this.canvas,
			width,
			height,
		)
		if (!this.player.isPlaying()) {
			this.render()
		}
	}

	showPlayerError(message) {
		const div = document.createElement('div')
		div.className = 'player-error'
		if (message) {
			div.innerText = `Error "${message}". See the console for details.`
		} else {
			div.innerText = `Something went wrong. See the console for details.`
		}
		this.#container.prepend(div)
	}

	setTimelineAttributes() {
		this.#timeline.min = this.player.getStartFrame()
		this.#timeline.max = this.player.getEndFrame()
		this.#timeline.value = this.player.getStartFrame()
		this.#timeline?.addEventListener('input', ({ target }) => {
			const playing = this.player.isPlaying()
			const frame = parseInt(target.value)
			if (playing) {
				this.stop()
			}
			this.player.setFrame(frame)
			this.render()
			if (playing) {
				this.play()
			}
		})
	}

	runPlaybackLoop() {
		const tick = (timestamp) => {
			if (!this.player || !this.player.isPlaying()) {
				return
			}
			const status = this.player.tick(this.#surface, timestamp)
			if (status.frameChanged) {
				this.#timeline.value = status.currentFrame
			}
			this.#animationFrameId = requestAnimationFrame(tick)
		}
		this.#animationFrameId = requestAnimationFrame(tick)
	}

	togglePlayback() {
		if (!this.player) {
			return
		}
		if (this.player.isPlaying()) {
			this.stop()
		} else {
			this.play()
		}
	}

	prev() {
		if (this.player.isPlaying()) {
			this.stop()
		}
		const frame = parseInt(this.#timeline.value) - 1
		this.#timeline.value = frame
		this.player.setFrame(frame)
		this.render()
	}

	next() {
		if (this.player.isPlaying()) {
			this.stop()
		}
		const frame = parseInt(this.#timeline.value) + 1
		this.#timeline.value = frame
		this.player.setFrame(frame)
		this.render()
	}

	play() {
		if (!this.player) {
			return
		}
		this.player.play()
		this.#playButton.innerText = 'Pause'
		this.runPlaybackLoop()
	}

	stop() {
		if (!this.player) {
			return
		}
		this.player.stop()
		this.#playButton.innerText = 'Play'
		if (this.#animationFrameId !== null) {
			cancelAnimationFrame(this.#animationFrameId)
			this.#animationFrameId = null
		}
	}

	restart() {
		const playing = this.player.isPlaying()
		this.stop()
		this.player.setFrame(0)
		this.#timeline.value = 0
		if (playing) {
			this.play()
		} else {
			this.render()
		}
	}

	render() {
		if (!this.player) {
			return
		}
		this.player.render(this.#surface)
	}
}

function vectorToArray(vector) {
	if (typeof vector?.size !== 'function') {
		return []
	}
	// Convert Emscripten vector to JavaScript array
	return new Array(vector.size()).fill(0).map((_, index) => vector.get(index))
}
