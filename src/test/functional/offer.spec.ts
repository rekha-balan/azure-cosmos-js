import * as assert from "assert";
import * as Stream from "stream";
import {
    AzureDocuments, Base, Constants, CosmosClient,
    DocumentBase, HashPartitionResolver, Range,
    RangePartitionResolver, Response, RetryOptions,
} from "../../";
import testConfig from "./../common/_testConfig";
import { TestHelpers } from "./../common/TestHelpers";

// Used for sproc
declare var getContext: any;
// declare var body: (input?: any) => void; // TODO: remove this if it's not necessary

// TODO: should fix long lines
// tslint:disable:max-line-length

const host = testConfig.host;
const masterKey = testConfig.masterKey;

describe("NodeJS CRUD Tests", function () {
    this.timeout(process.env.MOCHA_TIMEOUT || 10000);
    // remove all databases from the endpoint before each test
    beforeEach(async function () {
        this.timeout(10000);
        try {
            await TestHelpers.removeAllDatabases(host, masterKey);
        } catch (err) {
            throw err;
        }
    });

    describe("Validate Offer CRUD", function () {
        const validateOfferResponseBody = function (offer: any, expectedCollLink: string, expectedOfferType: string) {
            assert(offer.id, "Id cannot be null");
            assert(offer._rid, "Resource Id (Rid) cannot be null");
            assert(offer._self, "Self Link cannot be null");
            assert(offer.resource, "Resource Link cannot be null");
            assert(offer._self.indexOf(offer.id) !== -1, "Offer id not contained in offer self link.");
            assert.equal(expectedCollLink.replace(/^\/|\/$/g, ""), offer.resource.replace(/^\/|\/$/g, ""));
            if (expectedOfferType) {
                assert.equal(expectedOfferType, offer.offerType);
            }
        };

        const offerReadAndQueryTest = async function (isNameBased: boolean, isPartitionedCollection: boolean, offerThroughput: number, expectedCollectionSize: number) {
            const client = new CosmosClient(host, { masterKey });
            // create database
            const { result: db } = await client.createDatabase({ id: "new database" });
            const collectionRequestOptions = { offerThroughput };
            let collectionDefinition: any = "";
            if (isPartitionedCollection) {
                collectionDefinition = {
                    id: Base.generateGuidId(),
                    indexingPolicy: {
                        includedPaths: [
                            {
                                path: "/",
                                indexes: [
                                    {
                                        kind: "Range",
                                        dataType: "Number",
                                    },
                                    {
                                        kind: "Range",
                                        dataType: "String",
                                    },
                                ],
                            },
                        ],
                    },
                    partitionKey: {
                        paths: [
                            "/id",
                        ],
                        kind: "Hash",
                    },
                };
            } else {
                collectionDefinition = { id: "sample collection" };
            }
            const { result: createdCollection } = await client.createCollection(
                TestHelpers.getDatabaseLink(isNameBased, db), collectionDefinition, collectionRequestOptions);

            const { result: collection, headers } = await client.readCollection(
                TestHelpers.getCollectionLink(isNameBased, db, createdCollection), { populateQuotaInfo: true });

            // Validate the collection size quota
            assert.notEqual(headers[Constants.HttpHeaders.MaxResourceQuota], null);
            assert.notEqual(headers[Constants.HttpHeaders.MaxResourceQuota], "");
            const collectionSize: number = Number((headers[Constants.HttpHeaders.MaxResourceQuota] as string).split(";")
                .reduce((map: any, obj: string) => {
                    const items = obj.split("=");
                    map[items[0]] = items[1];
                    return map;
                }, {})[Constants.Quota.CollectionSize]);
            assert.equal(collectionSize, expectedCollectionSize, "Collection size is unexpected");

            const { result: offers } = await client.readOffers({}).toArray();
            assert.equal(offers.length, 1);
            const expectedOffer = offers[0];
            assert.equal(expectedOffer.content.offerThroughput, collectionRequestOptions.offerThroughput, "Expected offerThroughput to be " + collectionRequestOptions.offerThroughput);
            validateOfferResponseBody(expectedOffer, collection._self, undefined);
            // Read the offer
            const { result: readOffer } = await client.readOffer(expectedOffer._self);
            validateOfferResponseBody(readOffer, collection._self, undefined);
            // Check if the read offer is what we expected.
            assert.equal(expectedOffer.id, readOffer.id);
            assert.equal(expectedOffer._rid, readOffer._rid);
            assert.equal(expectedOffer._self, readOffer._self);
            assert.equal(expectedOffer.resource, readOffer.resource);
            // Read offer with a bad offer link.
            try {
                const badLink = expectedOffer._self.substring(0, expectedOffer._self.length - 1) + "x/";
                await client.readOffer(badLink);
                assert.fail("Must throw after read with bad offer");
            } catch (err) {
                const notFoundErrorCode = 400;
                assert.equal(err.code, notFoundErrorCode, "response should return error code 404");
            }
            // Query for offer.
            const querySpec = {
                query: "select * FROM root r WHERE r.id=@id",
                parameters: [
                    {
                        name: "@id",
                        value: expectedOffer.id,
                    },
                ],
            };
            const { result: offers2 } = await client.queryOffers(querySpec).toArray();
            assert.equal(offers2.length, 1);
            const oneOffer = offers2[0];
            validateOfferResponseBody(oneOffer, collection._self, undefined);
            // Now delete the collection.
            await client.deleteCollection(
                TestHelpers.getCollectionLink(isNameBased, db, collection));
            // read offer after deleting collection.
            try {
                await client.readOffer(expectedOffer._self);
                assert.fail("Must throw after delete");
            } catch (err) {
                const notFoundErrorCode = 404;
                assert.equal(err.code, notFoundErrorCode, "response should return error code 404");
            }
        };

        const mbInBytes = 1024 * 1024;
        const offerThroughputSinglePartitionCollection = 5000;
        const minOfferThroughputPCollectionWithMultiPartitions = 2000;
        const maxOfferThroughputPCollectionWithSinglePartition = minOfferThroughputPCollectionWithMultiPartitions - 100;

        it.skip("nativeApi Should do offer read and query operations successfully name based single partition collection", async function () {
            try {
                await offerReadAndQueryTest(true, false, offerThroughputSinglePartitionCollection, mbInBytes);
            } catch (err) {
                throw err;
            }
        });

        it.skip("nativeApi Should do offer read and query operations successfully rid based single partition collection", async function () {
            try {
                await offerReadAndQueryTest(false, false, offerThroughputSinglePartitionCollection, mbInBytes);
            } catch (err) {
                throw err;
            }
        });

        it.skip("nativeApi Should do offer read and query operations successfully w/ name based p-Collection w/ 1 partition", async function () {
            try {
                await offerReadAndQueryTest(true, true, maxOfferThroughputPCollectionWithSinglePartition, mbInBytes);
            } catch (err) {
                throw err;
            }
        });

        it.skip("nativeApi Should do offer read and query operations successfully w/ rid based p-Collection w/ 1 partition", async function () {
            try {
                await offerReadAndQueryTest(false, true, maxOfferThroughputPCollectionWithSinglePartition, mbInBytes);
            } catch (err) {
                throw err;
            }
        });

        it.skip("nativeApi Should do offer read and query operations successfully w/ name based p-Collection w/ multi partitions", async function () {
            try {
                await offerReadAndQueryTest(true, true, minOfferThroughputPCollectionWithMultiPartitions, 5 * mbInBytes);
            } catch (err) {
                throw err;
            }
        });

        it.skip("nativeApi Should do offer read and query operations successfully w/ rid based p-Collection w/ multi partitions", async function () {
            try {
                await offerReadAndQueryTest(false, true, minOfferThroughputPCollectionWithMultiPartitions, 5 * mbInBytes);
            } catch (err) {
                throw err;
            }
        });

        const offerReplaceTest = async function (isNameBased: boolean) {
            try {
                const client = new CosmosClient(host, { masterKey });
                // create database
                const { result: db } = await client.createDatabase({ id: "sample database" });
                // create collection
                const { result: collection } = await client.createCollection(
                    TestHelpers.getDatabaseLink(isNameBased, db), { id: "sample collection" });
                const { result: offers } = await client.readOffers().toArray();
                assert.equal(offers.length, 1);
                const expectedOffer = offers[0];
                validateOfferResponseBody(expectedOffer, collection._self, undefined);
                // Replace the offer.
                const offerToReplace = Base.extend({}, expectedOffer);
                const oldThroughput = offerToReplace.content.offerThroughput;
                offerToReplace.content.offerThroughput = oldThroughput + 100;
                const { result: replacedOffer } = await client.replaceOffer(offerToReplace._self, offerToReplace);
                validateOfferResponseBody(replacedOffer, collection._self, undefined);
                // Check if the replaced offer is what we expect.
                assert.equal(replacedOffer.id, offerToReplace.id);
                assert.equal(replacedOffer._rid, offerToReplace._rid);
                assert.equal(replacedOffer._self, offerToReplace._self);
                assert.equal(replacedOffer.resource, offerToReplace.resource);
                assert.equal(replacedOffer.content.offerThroughput, offerToReplace.content.offerThroughput);
                // Replace an offer with a bad id.
                try {
                    const offerBadId = Base.extend({}, offerToReplace);
                    offerBadId._rid = "NotAllowed";
                    await client.replaceOffer(offerBadId._self, offerBadId);
                    assert.fail("Must throw after replace with bad id");
                } catch (err) {
                    const badRequestErrorCode = 400;
                    assert.equal(err.code, badRequestErrorCode);
                }
                // Replace an offer with a bad rid.
                try {
                    const offerBadRid = Base.extend({}, offerToReplace);
                    offerBadRid._rid = "InvalidRid";
                    await client.replaceOffer(offerBadRid._self, offerBadRid);
                    assert.fail("Must throw after replace with bad rid");
                } catch (err) {
                    const badRequestErrorCode = 400;
                    assert.equal(err.code, badRequestErrorCode);
                }
                // Replace an offer with null id and rid.
                try {
                    const offerNullId = Base.extend({}, offerToReplace);
                    offerNullId.id = undefined;
                    offerNullId._rid = undefined;
                    await client.replaceOffer(offerNullId._self, offerNullId);
                    assert.fail("Must throw after repalce with null id and rid");
                } catch (err) {
                    const badRequestErrorCode = 400;
                    assert.equal(err.code, badRequestErrorCode);
                }
            } catch (err) {
                throw err;
            }
        };

        it("nativeApi Should do offer replace operations successfully name based", async function () {
            try {
                await offerReplaceTest(true);
            } catch (err) {
                throw err;
            }
        });

        it("nativeApi Should do offer replace operations successfully rid based", async function () {
            try {
                await offerReplaceTest(false);
            } catch (err) {
                throw err;
            }
        });

        const createCollectionWithOfferTypeTest = async function (isNameBased: boolean) {
            try {
                const client = new CosmosClient(host, { masterKey });
                // create database
                const { result: db } = await client.createDatabase({ id: "sample database" });
                // create collection
                const { result: collection } = await client.createCollection(
                    TestHelpers.getDatabaseLink(isNameBased, db), { id: "sample collection" }, { offerType: "S2" });
                const { result: offers } = await client.readOffers().toArray();
                assert.equal(offers.length, 1);
                const expectedOffer = offers[0];
                assert.equal(expectedOffer.offerType, "S2");
            } catch (err) {
                throw err;
            }
        };

        it("nativeApi Should create collection with specified offer type successfully name based", async function () {
            try {
                await createCollectionWithOfferTypeTest(true);
            } catch (err) {
                throw err;
            }
        });

        it("nativeApi Should create collection with specified offer type successfully rid based", async function () {
            try {
                await createCollectionWithOfferTypeTest(false);
            } catch (err) {
                throw err;
            }
        });
    });
});
