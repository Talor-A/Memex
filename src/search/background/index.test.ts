import StorageManager from '@worldbrain/storex'
import normalize from 'src/util/encode-url-for-id'
import * as DATA from './index.test.data'
import { PageUrlsByDay } from './types'
import { setupBackgroundIntegrationTest } from 'src/tests/background-integration-tests'
import { BackgroundModules } from 'src/background-script/setup'

const mockEvent = { addListener: () => undefined }

const countAnnots = res => {
    return res.docs.reduce(
        (count, { annotations }) => count + annotations.length,
        0,
    )
}

const flattenAnnotUrls = res => {
    return res.docs.reduce(
        (urls, { annotations }) => [...urls, ...annotations.map(a => a.url)],
        [],
    )
}

describe('Annotations search', () => {
    async function insertTestData({
        storageManager,
        backgroundModules,
    }: {
        storageManager: StorageManager
        backgroundModules: BackgroundModules
    }) {
        const annotsStorage = backgroundModules.directLinking.annotationStorage
        const customListsBg = backgroundModules.customLists

        for (const annot of [
            DATA.directLink,
            DATA.highlight,
            DATA.annotation,
            DATA.comment,
            DATA.hybrid,
        ]) {
            // Pages also need to be seeded to match domains filters against
            await storageManager.collection('pages').createObject({
                url: annot.pageUrl,
                hostname: normalize(annot.pageUrl),
                domain: normalize(annot.pageUrl),
                title: annot.pageTitle,
                text: annot.body,
                canonicalUrl: annot.url,
            })

            // Create a dummy visit 30 secs before annot creation time
            await storageManager.collection('visits').createObject({
                url: annot.pageUrl,
                time: new Date(annot.createdWhen.getTime() - 300000).getTime(),
            })

            await annotsStorage.createAnnotation(annot as any)
        }

        // Insert bookmarks
        await annotsStorage.toggleAnnotBookmark({
            url: DATA.directLink.url,
        })
        await annotsStorage.toggleAnnotBookmark({ url: DATA.hybrid.url })
        await annotsStorage.toggleAnnotBookmark({ url: DATA.highlight.url })

        // Insert collections + collection entries
        const coll1Id = await customListsBg.createCustomList({
            name: DATA.coll1,
        })
        const coll2Id = await customListsBg.createCustomList({
            name: DATA.coll2,
        })
        await annotsStorage.insertAnnotToList({
            listId: coll1Id,
            url: DATA.hybrid.url,
        })
        await annotsStorage.insertAnnotToList({
            listId: coll2Id,
            url: DATA.highlight.url,
        })

        // Insert tags
        await annotsStorage.modifyTags(true)(DATA.tag1, DATA.annotation.url)
        await annotsStorage.modifyTags(true)(DATA.tag2, DATA.annotation.url)

        // I don't know why this happens: seemingly only in jest,
        //  `getTagsByAnnotationUrl` returns one less result than it's meant to.
        //  The best fix I can find for now is adding a dummy tag...
        await annotsStorage.modifyTags(true)('dummy', DATA.annotation.url)
    }

    async function setupTest() {
        const setup = await setupBackgroundIntegrationTest({
            tabManager: { getActiveTab: () => ({ id: 1, url: 'test' }) } as any,
        })
        await insertTestData(setup)

        return {
            searchBg: setup.backgroundModules.search,
            annotsBg: setup.backgroundModules.directLinking,
        }
    }

    describe('terms-based searches', () => {
        test('plain terms search', async () => {
            const { searchBg } = await setupTest()

            const resA = await searchBg.searchAnnotations({
                query: 'comment',
            })
            expect(countAnnots(resA)).toBe(2)
            expect(flattenAnnotUrls(resA)).toEqual(
                expect.arrayContaining([DATA.comment.url, DATA.annotation.url]),
            )

            const resB = await searchBg.searchAnnotations({
                query: 'bla',
            })
            expect(countAnnots(resB)).toBe(2)
            expect(flattenAnnotUrls(resB)).toEqual(
                expect.arrayContaining([DATA.hybrid.url, DATA.annotation.url]),
            )
        })

        test('bookmarks filter', async () => {
            const { searchBg } = await setupTest()

            const resFiltered = await searchBg.searchAnnotations({
                query: 'bla',
                bookmarksOnly: true,
            })
            expect(countAnnots(resFiltered)).toBe(1)
            expect(flattenAnnotUrls(resFiltered)).toEqual(
                expect.arrayContaining([DATA.hybrid.url]),
            )

            const resUnfiltered = await searchBg.searchAnnotations({
                query: 'bla',
                bookmarksOnly: false,
            })
            expect(countAnnots(resUnfiltered)).toBe(2)
            expect(flattenAnnotUrls(resUnfiltered)).toEqual(
                expect.arrayContaining([DATA.hybrid.url, DATA.annotation.url]),
            )
        })

        // test('collections filter', async () => {
        //     const { searchBg } = await setupTest()

        //     const resA = await searchBg.searchAnnotations({
        //         query: 'quote',
        //         lists: [DATA.coll1, DATA.coll2],
        //     } as any)

        //     expect(countAnnots(resA)).toBe(1)

        //     const resB = await searchBg.searchAnnotations({
        //         query: 'quote',
        //         lists: ['not a real coll'],
        //     } as any)

        //     expect(countAnnots(resB)).toBe(0)
        // })

        test('tags filter', async () => {
            const { searchBg } = await setupTest()

            const resFiltered = await searchBg.searchAnnotations({
                query: 'comment',
                tagsInc: [DATA.tag1],
            })
            expect(countAnnots(resFiltered)).toBe(1)
            expect(flattenAnnotUrls(resFiltered)).toEqual(
                expect.arrayContaining([DATA.annotation.url]),
            )

            const resUnfiltered = await searchBg.searchAnnotations({
                query: 'comment',
            })
            expect(countAnnots(resUnfiltered)).toBe(2)
            expect(flattenAnnotUrls(resUnfiltered)).toEqual(
                expect.arrayContaining([DATA.annotation.url, DATA.comment.url]),
            )
        })

        test('domains filter', async () => {
            const { searchBg } = await setupTest()

            const resUnfiltered = await searchBg.searchAnnotations({
                query: 'highlight',
            })
            expect(countAnnots(resUnfiltered)).toBe(2)
            expect(flattenAnnotUrls(resUnfiltered)).toEqual(
                expect.arrayContaining([DATA.hybrid.url, DATA.highlight.url]),
            )

            const resExc = await searchBg.searchAnnotations({
                query: 'highlight',
                domainsExclude: ['annotation.url'],
            })
            expect(countAnnots(resExc)).toBe(1)
            expect(flattenAnnotUrls(resExc)).toEqual(
                expect.arrayContaining([DATA.hybrid.url]),
            )

            const resInc = await searchBg.searchAnnotations({
                query: 'highlight',
                domains: ['annotation.url'],
            })
            expect(countAnnots(resInc)).toBe(1)
            expect(flattenAnnotUrls(resInc)).toEqual(
                expect.arrayContaining([DATA.highlight.url]),
            )
        })

        // test('result limit parameter', async () => {
        //     const { searchBg } = await setupTest()

        //     const single = await searchBg.searchAnnotations({
        //         query: 'term',
        //         limit: 1,
        //     })
        //     const double = await searchBg.searchAnnotations({
        //         query: 'term',
        //         limit: 2,
        //     })
        //     const triple = await searchBg.searchAnnotations({
        //         query: 'term',
        //         limit: 3,
        //     })

        //     expect(countAnnots(single)).toBe(1)
        //     expect(countAnnots(double)).toBe(2)
        //     expect(countAnnots(triple)).toBe(3)
        // })

        // test('page URL filter', async () => {
        //     const { searchBg } = await setupTest()

        //     const resA = await searchBg.searchAnnotations({
        //         query: 'quote',
        //         url: DATA.directLink.pageUrl,
        //     })
        //     expect(countAnnots(resA)).toBe(1)
        //     expect(flattenAnnotUrls(resA)).toEqual(
        //         expect.arrayContaining([DATA.directLink.url]),
        //     )

        //     const resB = await searchBg.searchAnnotations({
        //         query: 'quote',
        //         url: DATA.hybrid.pageUrl,
        //     })
        //     expect(countAnnots(resB)).toBe(1)
        //     expect(flattenAnnotUrls(resB)).toEqual(
        //         expect.arrayContaining([DATA.directLink.url]),
        //     )
        // })

        test('comment-terms only terms search', async () => {
            const { searchBg } = await setupTest()

            const resCommentsOnly = await searchBg.searchAnnotations({
                query: 'term',
                contentTypes: { highlights: false, notes: true, pages: false },
            })
            expect(countAnnots(resCommentsOnly)).toBe(1)
            expect(flattenAnnotUrls(resCommentsOnly)).toEqual(
                expect.arrayContaining([DATA.hybrid.url]),
            )

            const resAllFields = await searchBg.searchAnnotations({
                query: 'term',
            })
            expect(countAnnots(resAllFields)).toBe(3)
            expect(flattenAnnotUrls(resAllFields)).toEqual(
                expect.arrayContaining([
                    DATA.hybrid.url,
                    DATA.annotation.url,
                    DATA.comment.url,
                ]),
            )
        })

        test('highlighted-text-terms only terms search', async () => {
            const { searchBg } = await setupTest()

            const resBodyOnly = await searchBg.searchAnnotations({
                query: 'term',
                contentTypes: { highlights: true, notes: false, pages: false },
            })
            expect(countAnnots(resBodyOnly)).toBe(2)
            expect(flattenAnnotUrls(resBodyOnly)).toEqual(
                expect.arrayContaining([DATA.annotation.url, DATA.comment.url]),
            )

            const resAllFields = await searchBg.searchAnnotations({
                query: 'term',
            })
            expect(countAnnots(resAllFields)).toBe(3)
            expect(flattenAnnotUrls(resAllFields)).toEqual(
                expect.arrayContaining([
                    DATA.hybrid.url,
                    DATA.annotation.url,
                    DATA.comment.url,
                ]),
            )
        })
    })

    // describe('url-based search', () => {
    //     test('blank', async () => {
    //         const { searchBg, annotsBg } = await setupTest()
    //         const results = await annotsBg.getAllAnnotationsByUrl(
    //             { tab: null },
    //             { url: DATA.pageUrl },
    //         )

    //         expect(results.length).toBe(3)
    //     })

    //     test('bookmark filter', async () => {
    //         const { searchBg, annotsBg } = await setupTest()
    //         const results = await annotsBg.getAllAnnotationsByUrl(
    //             { tab: null },
    //             { url: DATA.pageUrl, bookmarksOnly: true },
    //         )

    //         expect(results.length).toBe(1)
    //     })

    //     test('tag inc filter', async () => {
    //         const { searchBg, annotsBg } = await setupTest()
    //         const results = await annotsBg.getAllAnnotationsByUrl(
    //             { tab: null },
    //             {
    //                 url: DATA.pageUrl,
    //                 tagsInc: [DATA.tag1],
    //             },
    //         )

    //         expect(results.length).toBe(1)
    //     })

    //     test('tag exc filter', async () => {
    //         const { searchBg, annotsBg } = await setupTest()
    //         const results = await annotsBg.getAllAnnotationsByUrl(
    //             { tab: null },
    //             {
    //                 url: DATA.pageUrl,
    //                 tagsExc: [DATA.tag1, DATA.tag2, 'dummy'],
    //             },
    //         )

    //         expect(results.length).toBe(0)
    //     })

    //     test('collection filter', async () => {
    //         const { searchBg, annotsBg } = await setupTest()
    //         const resA = await annotsBg.getAllAnnotationsByUrl({ tab: null }, {
    //             url: DATA.pageUrl,
    //             lists: [DATA.coll2],
    //         } as any)

    //         const resB = await annotsBg.getAllAnnotationsByUrl({ tab: null }, {
    //             url: DATA.pageUrl,
    //             lists: [DATA.coll1],
    //         } as any)

    //         expect(resA.length).toBe(1)
    //         expect(resB.length).toBe(0)
    //     })
    // })

    // describe('blank search', () => {
    //     test('all content types', async () => {
    //         const { searchBg, annotsBg } = await setupTest()
    //         const { docs: results } = await searchBg.searchPages({
    //             contentTypes: { highlights: true, notes: true, pages: true },
    //         })

    //         expect(results).toBeDefined()
    //         expect(results.length).toBe(3)

    //         Ensure order is by latest visit
    //         expect(results.map(res => res.url)).toEqual([
    //             DATA.hybrid.pageUrl,
    //             DATA.highlight.pageUrl,
    //             DATA.directLink.pageUrl,
    //         ])

    //         const resByUrl = new Map()
    //         results.forEach(res => resByUrl.set(res.url, res))

    //         expect(resByUrl.get(DATA.pageUrl).annotations.length).toBe(3)
    //         expect(
    //             resByUrl.get(DATA.directLink.pageUrl).annotations.length,
    //         ).toBe(1)
    //         expect(resByUrl.get(DATA.hybrid.pageUrl).annotations.length).toBe(1)
    //     })

    //     test('annots-only', async () => {
    //         const { searchBg, annotsBg } = await setupTest()
    //         const {
    //             docs: results,
    //             resultsExhausted,
    //         } = await searchBg.searchAnnotations({})

    //         expect(resultsExhausted).toBe(true)
    //         expect(results).toBeDefined()
    //         expect(results.length).toBe(3)

    //         Ensure order of pages is by latest annot
    //         expect(results.map(res => res.url)).toEqual([
    //             DATA.hybrid.pageUrl,
    //             DATA.annotation.pageUrl,
    //             DATA.directLink.pageUrl,
    //         ])

    //         For each page, ensure order of annots is by latest
    //         expect(results[0].annotations.map(annot => annot.url)).toEqual([
    //             DATA.hybrid.url,
    //         ])
    //         expect(results[1].annotations.map(annot => annot.url)).toEqual([
    //             DATA.annotation.url,
    //             DATA.comment.url,
    //             DATA.highlight.url,
    //         ])
    //         expect(results[2].annotations.map(annot => annot.url)).toEqual([
    //             DATA.directLink.url,
    //         ])
    //     })

    //     test('time filters', async () => {
    //         const { searchBg, annotsBg } = await setupTest()
    //         Should result in only the newest annot
    //         const { docs: resA } = await searchBg.searchAnnotations({
    //             startDate: new Date('2019-01-30'),
    //         })

    //         expect(resA).toBeDefined()
    //         expect(resA.length).toBe(1)

    //         expect(resA[0].annotations.length).toBe(1)
    //         expect(resA[0].annotations[0].url).toBe(DATA.hybrid.url)

    //         Should result in only the oldest annot
    //         const { docs: resB } = await searchBg.searchAnnotations({
    //             endDate: new Date('2019-01-26'),
    //         })

    //         expect(resB).toBeDefined()
    //         expect(resB.length).toBe(1)

    //         expect(resB[0].annotations.length).toBe(1)
    //         expect(resB[0].annotations[0].url).toBe(DATA.highlight.url)

    //         Should result in only the oldest annot
    //         const { docs: resC } = await searchBg.searchAnnotations({
    //             startDate: new Date('2019-01-25'),
    //             endDate: new Date('2019-01-28T23:00Z'),
    //         })

    //         expect(resC).toBeDefined()
    //         expect(resC.length).toBe(1)

    //         expect(resC[0].annotations.length).toBe(2)
    //         expect(resC[0].annotations[0].url).toBe(DATA.comment.url)
    //         expect(resC[0].annotations[1].url).toBe(DATA.highlight.url)
    //     })

    //     test('tags filter', async () => {
    //         const { searchBg, annotsBg } = await setupTest()
    //         const {
    //             docs: results,
    //             resultsExhausted,
    //         } = await searchBg.searchAnnotations({
    //             tagsInc: [DATA.tag1],
    //         })

    //         expect(resultsExhausted).toBe(true)
    //         expect(results).toBeDefined()
    //         expect(results.length).toBe(1)

    //         expect(results[0].annotations.length).toBe(1)
    //         expect(results[0].annotations[0].url).toEqual(DATA.annotation.url)
    //     })
    // })
})
