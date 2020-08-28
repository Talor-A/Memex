import {
    Template,
    TemplateDoc,
    TemplateAnalysis,
    TemplateRequirements,
    TemplateDocKey,
    TemplateDocNote,
    TemplateDataFetchers,
} from './types'
import mustache from 'mustache'
import { KEYS_TO_REQUIREMENTS, LEGACY_KEYS, NOTE_KEYS } from './constants'

export function renderTemplate(
    template: Pick<Template, 'code'>,
    doc: TemplateDoc,
): string {
    return mustache.render(template.code, doc)
}

export function analyzeTemplate(
    template: Pick<Template, 'code'>,
): TemplateAnalysis {
    const templateDoc: TemplateDoc = {}
    for (const key of Object.keys(KEYS_TO_REQUIREMENTS)) {
        templateDoc[key] = `@key%${key}.single@endkey%`
    }

    const note: TemplateDocNote = {}
    for (const key of Object.keys(NOTE_KEYS)) {
        note[key] = `@key%${key}.multiple@endkey%`
    }
    templateDoc['Notes'] = [note]
    const rendered = renderTemplate(template, templateDoc)

    // We don't keep this as a global because it's stateful  :(
    const requirementRegex = /@key%([a-zA-Z\.]+)@endkey%/g

    const requirements: TemplateRequirements = {}
    let usesLegacyTags = false
    let noteUsage: TemplateAnalysis['noteUsage']
    while (true) {
        const match = requirementRegex.exec(rendered)
        if (!match) {
            break
        }

        const identifier = match[1].split('.')
        const key = identifier[0] as TemplateDocKey
        const usage = identifier[1] as TemplateAnalysis['noteUsage']
        if (NOTE_KEYS[key]) {
            // If one multiple usage is there, ignore the single usages
            if (!noteUsage || usage === 'multiple') {
                noteUsage = usage
            }
        }

        const requirement = KEYS_TO_REQUIREMENTS[key]
        requirements[requirement] = true
        usesLegacyTags = usesLegacyTags || LEGACY_KEYS.has(key)
    }

    return { usesLegacyTags, noteUsage, requirements }
}

export async function generateTemplateDocs(params: {
    template: Pick<Template, 'code'>
    normalizedPageUrls: string[]
    annotationUrls: string[]
    dataFetchers: TemplateDataFetchers
}): Promise<TemplateDoc[]> {
    const templateAnalysis = analyzeTemplate(params.template)
    return [{}]
}
