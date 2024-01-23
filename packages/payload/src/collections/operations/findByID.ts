/* eslint-disable no-underscore-dangle */
import type { FindOneArgs } from '../../database/types'
import type { PayloadRequest } from '../../types'
import type { Collection, TypeWithID } from '../config/types'

import executeAccess from '../../auth/executeAccess'
import { combineQueries } from '../../database/combineQueries'
import { NotFound } from '../../errors'
import { afterRead } from '../../fields/hooks/afterRead'
import { commitTransaction } from '../../utilities/commitTransaction'
import { initTransaction } from '../../utilities/initTransaction'
import { killTransaction } from '../../utilities/killTransaction'
import replaceWithDraftIfAvailable from '../../versions/drafts/replaceWithDraftIfAvailable'
import { buildAfterOperation } from './utils'

export type Arguments = {
  collection: Collection
  currentDepth?: number
  depth?: number
  disableErrors?: boolean
  draft?: boolean
  id: number | string
  overrideAccess?: boolean
  req: PayloadRequest
  showHiddenFields?: boolean
}

export const findByIDOperation = async <T extends TypeWithID>(
  incomingArgs: Arguments,
): Promise<T> => {
  let args = incomingArgs

  // /////////////////////////////////////
  // beforeOperation - Collection
  // /////////////////////////////////////

  await args.collection.config.hooks.beforeOperation.reduce(async (priorHook, hook) => {
    await priorHook

    args =
      (await hook({
        args,
        collection: args.collection.config,
        context: args.req.context,
        operation: 'read',
      })) || args
  }, Promise.resolve())

  const {
    id,
    collection: { config: collectionConfig },
    currentDepth,
    depth,
    disableErrors,
    draft: draftEnabled = false,
    overrideAccess = false,
    req: { locale },
    req,
    showHiddenFields,
  } = args

  try {
    const shouldCommit = await initTransaction(req)

    // /////////////////////////////////////
    // Access
    // /////////////////////////////////////

    const accessResult = !overrideAccess
      ? await executeAccess({ id, disableErrors, req }, collectionConfig.access.read)
      : true

    // If errors are disabled, and access returns false, return null
    if (accessResult === false) return null

    const findOneArgs: FindOneArgs = {
      collection: collectionConfig.slug,
      locale,
      req: {
        transactionID: req.transactionID,
      } as PayloadRequest,
      where: combineQueries({ id: { equals: id } }, accessResult),
    }

    // /////////////////////////////////////
    // Find by ID
    // /////////////////////////////////////

    if (!findOneArgs.where.and[0].id) throw new NotFound(req.t)

    let result = await req.payload.db.findOne<T>(findOneArgs)

    if (!result) {
      if (!disableErrors) {
        throw new NotFound(req.t)
      }

      return null
    }

    // Clone the result - it may have come back memoized
    result = JSON.parse(JSON.stringify(result))

    // /////////////////////////////////////
    // Replace document with draft if available
    // /////////////////////////////////////

    if (collectionConfig.versions?.drafts && draftEnabled) {
      result = await replaceWithDraftIfAvailable({
        accessResult,
        doc: result,
        entity: collectionConfig,
        entityType: 'collection',
        overrideAccess,
        req,
      })
    }

    // /////////////////////////////////////
    // beforeRead - Collection
    // /////////////////////////////////////

    await collectionConfig.hooks.beforeRead.reduce(async (priorHook, hook) => {
      await priorHook

      result =
        (await hook({
          collection: collectionConfig,
          context: req.context,
          doc: result,
          query: findOneArgs.where,
          req,
        })) || result
    }, Promise.resolve())

    // /////////////////////////////////////
    // afterRead - Fields
    // /////////////////////////////////////

    result = await afterRead({
      collection: collectionConfig,
      context: req.context,
      currentDepth,
      depth,
      doc: result,
      global: null,
      overrideAccess,
      req,
      showHiddenFields,
    })

    // /////////////////////////////////////
    // afterRead - Collection
    // /////////////////////////////////////

    await collectionConfig.hooks.afterRead.reduce(async (priorHook, hook) => {
      await priorHook

      result =
        (await hook({
          collection: collectionConfig,
          context: req.context,
          doc: result,
          query: findOneArgs.where,
          req,
        })) || result
    }, Promise.resolve())

    // /////////////////////////////////////
    // afterOperation - Collection
    // /////////////////////////////////////

    result = await buildAfterOperation<T>({
      args,
      collection: collectionConfig,
      operation: 'findByID',
      result: result as any,
    }) // TODO: fix this typing

    // /////////////////////////////////////
    // Return results
    // /////////////////////////////////////

    if (shouldCommit) await commitTransaction(req)

    return result
  } catch (error: unknown) {
    await killTransaction(req)
    throw error
  }
}
