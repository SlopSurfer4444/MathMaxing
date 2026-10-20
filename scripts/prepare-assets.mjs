import { cpSync, mkdirSync } from 'node:fs'
mkdirSync(new URL('../public/mathlive/', import.meta.url), { recursive: true })
cpSync(new URL('../node_modules/mathlive/fonts/', import.meta.url), new URL('../public/mathlive/fonts/', import.meta.url), { recursive: true })
