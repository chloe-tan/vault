import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import dotenv from 'dotenv'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { buildApp } from '@/app'

import * as schema from '../src/db/schema'

dotenv.config()

describe('Get OTP test', () => {
  let container: StartedPostgreSqlContainer
  let app: FastifyInstance
  const testPhoneNumber = process.env.TEST_PHONE_NUMBER as string
  const testNickname = 'Jean'

  beforeAll(async () => {
    container = await new PostgreSqlContainer().start()
    const connectionUri = container.getConnectionUri()
    app = await buildApp({
      database: {
        connectionString: connectionUri,
      },
      app: {
        port: 8080,
      },
    })

    await app.ready()

    // reset db
    await app.db.delete(schema.registration)
  })

  afterAll(async () => {
    await app.close()
    await container.stop()
  })

  test('should send the otp to valid registered user : /get_otp', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/get_otp',
      body: {
        phone_number: testPhoneNumber,
        nickname: testNickname,
      },
    })

    expect(response.statusCode).toBe(200)
  })

  test('should fail for invalid phone_number', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/get_otp',
      body: {
        phone_number: '0',
        nickname: testNickname,
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toHaveProperty('message', 'body/phone_number must match pattern "^\\+[1-9]\\d{1,14}$"')
  })

  test('should fail for invalid nickname', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/get_otp',
      body: {
        phone_number: testPhoneNumber,
        nickname: '',
      },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toHaveProperty('message', 'body/nickname must match pattern "^[A-Za-z]{1,20}$"')
  })
})
