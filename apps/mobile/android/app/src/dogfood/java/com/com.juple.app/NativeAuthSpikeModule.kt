package com.juple.app

import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.microsoft.identity.client.PublicClientApplication
import com.microsoft.identity.common.java.exception.BaseException
import com.microsoft.identity.nativeauth.INativeAuthPublicClientApplication
import com.microsoft.identity.nativeauth.NativeAuthPublicClientApplication
import com.microsoft.identity.nativeauth.parameters.NativeAuthGetAccessTokenParameters
import com.microsoft.identity.nativeauth.parameters.NativeAuthSignInParameters
import com.microsoft.identity.nativeauth.parameters.NativeAuthSignUpParameters
import com.microsoft.identity.nativeauth.parameters.NativeAuthResetPasswordParameters
import com.microsoft.identity.nativeauth.statemachine.results.GetAccessTokenResult
import com.microsoft.identity.nativeauth.statemachine.results.GetAccountResult
import com.microsoft.identity.nativeauth.statemachine.results.SignInResult
import com.microsoft.identity.nativeauth.statemachine.results.SignInSubmitCodeResult
import com.microsoft.identity.nativeauth.statemachine.results.SignOutResult
import com.microsoft.identity.nativeauth.statemachine.results.SignUpResult
import com.microsoft.identity.nativeauth.statemachine.results.SignUpSubmitCodeResult
import com.microsoft.identity.nativeauth.statemachine.results.SignUpSubmitPasswordResult
import com.microsoft.identity.nativeauth.statemachine.results.ResetPasswordStartResult
import com.microsoft.identity.nativeauth.statemachine.results.ResetPasswordSubmitCodeResult
import com.microsoft.identity.nativeauth.statemachine.results.ResetPasswordSubmitPasswordResult
import com.microsoft.identity.nativeauth.statemachine.results.ResetPasswordResult
import com.microsoft.identity.nativeauth.statemachine.states.AccountState
import com.microsoft.identity.nativeauth.statemachine.states.SignInCodeRequiredState
import com.microsoft.identity.nativeauth.statemachine.states.SignUpCodeRequiredState
import com.microsoft.identity.nativeauth.statemachine.states.SignUpPasswordRequiredState
import com.microsoft.identity.nativeauth.statemachine.states.ResetPasswordCodeRequiredState
import com.microsoft.identity.nativeauth.statemachine.states.ResetPasswordPasswordRequiredState
import com.microsoft.identity.nativeauth.statemachine.states.SignInContinuationState
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.Locale
import java.util.TimeZone

/** Dogfood-only feasibility probe. Passwords and tokens are never returned to JS or logged. */
class NativeAuthSpikeModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  companion object {
    private const val API_SCOPE = "api://14bcc3b7-7b37-4051-9e40-63cc2a5ffc8b/access_as_user"
    private const val API_BOOTSTRAP = "https://ca-juple-api-dev.proudfield-673db2f2.koreacentral.azurecontainerapps.io/api/v1/users/me/bootstrap"
    private const val API_ACCOUNT = "https://ca-juple-api-dev.proudfield-673db2f2.koreacentral.azurecontainerapps.io/api/v1/account"
    private const val API_AUDIENCE = "14bcc3b7-7b37-4051-9e40-63cc2a5ffc8b"
    private const val TENANT_ID = "d2e79a05-cf5f-43ab-86d2-717e025a74b1"
  }

  private val executor = Executors.newSingleThreadExecutor()
  private val client: INativeAuthPublicClientApplication by lazy {
    PublicClientApplication.createNativeAuthPublicClientApplication(context, R.raw.auth_config_native_auth)
  }
  private var codeState: SignInCodeRequiredState? = null
  private var signUpCodeState: SignUpCodeRequiredState? = null
  private var signUpPasswordState: SignUpPasswordRequiredState? = null
  private var resetCodeState: ResetPasswordCodeRequiredState? = null
  private var resetPasswordState: ResetPasswordPasswordRequiredState? = null

  override fun getName(): String = "NativeAuthSpike"

  @ReactMethod
  fun signIn(email: String, password: String, promise: Promise) {
    executor.execute {
      try {
        val passwordChars = password.toCharArray()
        val parameters = NativeAuthSignInParameters(email.trim()).apply {
          this.password = passwordChars
          scopes = listOf(API_SCOPE)
        }
        client.signIn(parameters, object : NativeAuthPublicClientApplication.SignInCallback {
          override fun onResult(result: SignInResult) {
            passwordChars.fill('\u0000')
            when (result) {
              is SignInResult.Complete -> finish(result.resultValue, promise)
              is SignInResult.CodeRequired -> {
                codeState = result.nextState
                promise.resolve(Arguments.createMap().apply { putString("state", "codeRequired") })
              }
              else -> promise.resolve(Arguments.createMap().apply { putString("state", "signInRejected") })
            }
          }

          override fun onError(error: BaseException) {
            passwordChars.fill('\u0000')
            promise.reject("nativeAuthFailed", "Native Authentication failed")
          }
        })
      } catch (_: Exception) {
        promise.reject("nativeAuthFailed", "Native Authentication failed")
      }
    }
  }

  @ReactMethod
  fun submitOtp(code: String, promise: Promise) {
    val state = codeState ?: run {
      promise.reject("noChallenge", "No verification challenge is pending")
      return
    }
    state.submitCode(code, object : SignInCodeRequiredState.SubmitCodeCallback {
      override fun onResult(result: SignInSubmitCodeResult) {
        if (result is SignInResult.Complete) {
          codeState = null
          finish(result.resultValue, promise)
        } else {
          promise.resolve(Arguments.createMap().apply { putString("state", "codeRejected") })
        }
      }

      override fun onError(error: BaseException) {
        promise.reject("nativeAuthFailed", "Verification failed")
      }
    })
  }

  @ReactMethod
  fun signUp(email: String, password: String, promise: Promise) {
    executor.execute {
      try {
        val chars = password.toCharArray()
        val parameters = NativeAuthSignUpParameters(email.trim()).apply { this.password = chars }
        client.signUp(parameters, object : NativeAuthPublicClientApplication.SignUpCallback {
          override fun onResult(result: SignUpResult) {
            chars.fill('\u0000')
            when (result) {
              is SignUpResult.CodeRequired -> {
                signUpCodeState = result.nextState
                promise.resolve(Arguments.createMap().apply { putString("state", "signUpCodeRequired") })
              }
              is SignUpResult.PasswordRequired -> {
                signUpPasswordState = result.nextState
                promise.resolve(Arguments.createMap().apply { putString("state", "signUpPasswordRequired") })
              }
              is SignUpResult.Complete -> continueAfterSignUp(result.nextState, promise)
              else -> promise.resolve(Arguments.createMap().apply { putString("state", "signUpRejected") })
            }
          }

          override fun onError(error: BaseException) {
            chars.fill('\u0000')
            promise.reject("signUpFailed", "Native sign-up failed")
          }
        })
      } catch (_: Exception) {
        promise.reject("signUpFailed", "Native sign-up failed")
      }
    }
  }

  @ReactMethod
  fun submitSignUpOtp(code: String, promise: Promise) {
    val state = signUpCodeState ?: run {
      promise.reject("noChallenge", "No sign-up challenge is pending")
      return
    }
    state.submitCode(code, object : SignUpCodeRequiredState.SubmitCodeCallback {
      override fun onResult(result: SignUpSubmitCodeResult) {
        when (result) {
          is SignUpResult.PasswordRequired -> {
            signUpCodeState = null
            signUpPasswordState = result.nextState
            promise.resolve(Arguments.createMap().apply { putString("state", "signUpPasswordRequired") })
          }
          is SignUpResult.Complete -> {
            signUpCodeState = null
            continueAfterSignUp(result.nextState, promise)
          }
          else -> promise.resolve(Arguments.createMap().apply { putString("state", "codeRejected") })
        }
      }

      override fun onError(error: BaseException) {
        promise.reject("signUpFailed", "Sign-up verification failed")
      }
    })
  }

  @ReactMethod
  fun submitSignUpPassword(password: String, promise: Promise) {
    val state = signUpPasswordState ?: run {
      promise.reject("noChallenge", "No sign-up password step is pending")
      return
    }
    val chars = password.toCharArray()
    state.submitPassword(chars, object : SignUpPasswordRequiredState.SignUpSubmitPasswordCallback {
      override fun onResult(result: SignUpSubmitPasswordResult) {
        chars.fill('\u0000')
        if (result is SignUpResult.Complete) {
          signUpPasswordState = null
          continueAfterSignUp(result.nextState, promise)
        } else {
          promise.resolve(Arguments.createMap().apply { putString("state", "passwordRejected") })
        }
      }

      override fun onError(error: BaseException) {
        chars.fill('\u0000')
        promise.reject("signUpFailed", "Sign-up password step failed")
      }
    })
  }

  private fun continueAfterSignUp(state: SignInContinuationState, promise: Promise) {
    state.signIn(listOf(API_SCOPE), object : SignInContinuationState.SignInContinuationCallback {
      override fun onResult(result: SignInResult) {
        when (result) {
          is SignInResult.Complete -> finish(result.resultValue, promise)
          is SignInResult.CodeRequired -> {
            codeState = result.nextState
            promise.resolve(Arguments.createMap().apply { putString("state", "codeRequired") })
          }
          else -> promise.resolve(Arguments.createMap().apply { putString("state", "signUpCompleteSignInRequired") })
        }
      }

      override fun onError(error: BaseException) {
        promise.resolve(Arguments.createMap().apply { putString("state", "signUpCompleteSignInRequired") })
      }
    })
  }

  @ReactMethod
  fun resetPassword(email: String, promise: Promise) {
    executor.execute {
      try {
        client.resetPassword(NativeAuthResetPasswordParameters(email.trim()), object : NativeAuthPublicClientApplication.ResetPasswordCallback {
          override fun onResult(result: ResetPasswordStartResult) {
            if (result is ResetPasswordStartResult.CodeRequired) {
              resetCodeState = result.nextState
              promise.resolve(Arguments.createMap().apply { putString("state", "resetCodeRequired") })
            } else {
              promise.resolve(Arguments.createMap().apply { putString("state", "resetRejected") })
            }
          }

          override fun onError(error: BaseException) {
            promise.reject("resetFailed", "Password reset could not start")
          }
        })
      } catch (_: Exception) {
        promise.reject("resetFailed", "Password reset could not start")
      }
    }
  }

  @ReactMethod
  fun submitResetOtp(code: String, promise: Promise) {
    val state = resetCodeState ?: run {
      promise.reject("noChallenge", "No reset challenge is pending")
      return
    }
    state.submitCode(code, object : ResetPasswordCodeRequiredState.SubmitCodeCallback {
      override fun onResult(result: ResetPasswordSubmitCodeResult) {
        if (result is ResetPasswordSubmitCodeResult.PasswordRequired) {
          resetCodeState = null
          resetPasswordState = result.nextState
          promise.resolve(Arguments.createMap().apply { putString("state", "resetPasswordRequired") })
        } else {
          promise.resolve(Arguments.createMap().apply { putString("state", "codeRejected") })
        }
      }

      override fun onError(error: BaseException) {
        promise.reject("resetFailed", "Password reset verification failed")
      }
    })
  }

  @ReactMethod
  fun submitResetPassword(password: String, promise: Promise) {
    val state = resetPasswordState ?: run {
      promise.reject("noChallenge", "No new-password step is pending")
      return
    }
    val chars = password.toCharArray()
    state.submitPassword(chars, object : ResetPasswordPasswordRequiredState.SubmitPasswordCallback {
      override fun onResult(result: ResetPasswordSubmitPasswordResult) {
        chars.fill('\u0000')
        if (result is ResetPasswordResult.Complete) {
          resetPasswordState = null
          promise.resolve(Arguments.createMap().apply { putString("state", "resetComplete") })
        } else {
          promise.resolve(Arguments.createMap().apply { putString("state", "passwordRejected") })
        }
      }

      override fun onError(error: BaseException) {
        chars.fill('\u0000')
        promise.reject("resetFailed", "New password was not accepted")
      }
    })
  }

  @ReactMethod
  fun refresh(promise: Promise) {
    executor.execute {
      try {
        client.getCurrentAccount(object : NativeAuthPublicClientApplication.GetCurrentAccountCallback {
          override fun onResult(result: GetAccountResult) {
            if (result is GetAccountResult.AccountFound) {
              finish(result.resultValue, promise, forceRefresh = true)
            } else {
              promise.resolve(Arguments.createMap().apply { putString("state", "noAccount") })
            }
          }

          override fun onError(error: BaseException) {
            promise.reject("refreshFailed", "Native session refresh failed")
          }
        })
      } catch (_: Exception) {
        promise.reject("refreshFailed", "Native session refresh failed")
      }
    }
  }

  @ReactMethod
  fun signOut(promise: Promise) {
    executor.execute {
      try {
        client.getCurrentAccount(object : NativeAuthPublicClientApplication.GetCurrentAccountCallback {
          override fun onResult(result: GetAccountResult) {
            if (result !is GetAccountResult.AccountFound) {
              promise.resolve(true)
              return
            }
            result.resultValue.signOut(object : AccountState.SignOutCallback {
              override fun onResult(result: SignOutResult) {
                promise.resolve(result is SignOutResult.Complete)
              }

              override fun onError(error: BaseException) {
                promise.reject("signOutFailed", "Native sign-out failed")
              }
            })
          }

          override fun onError(error: BaseException) {
            promise.reject("signOutFailed", "Native sign-out failed")
          }
        })
      } catch (_: Exception) {
        promise.reject("signOutFailed", "Native sign-out failed")
      }
    }
  }

  /** Only invoked from a visible, explicit confirmation in the dogfood spike. */
  @ReactMethod
  fun deleteAccount(promise: Promise) {
    executor.execute {
      try {
        client.getCurrentAccount(object : NativeAuthPublicClientApplication.GetCurrentAccountCallback {
          override fun onResult(result: GetAccountResult) {
            if (result !is GetAccountResult.AccountFound) {
              promise.resolve(Arguments.createMap().apply { putString("state", "noAccount") })
              return
            }
            val account = result.resultValue
            val parameters = NativeAuthGetAccessTokenParameters().apply { scopes = listOf(API_SCOPE) }
            account.getAccessToken(parameters, object : AccountState.GetAccessTokenCallback {
              override fun onResult(result: GetAccessTokenResult) {
                if (result !is GetAccessTokenResult.Complete) {
                  promise.reject("tokenFailed", "Could not acquire API token")
                  return
                }
                executor.execute {
                  try {
                    val connection = URL(API_ACCOUNT).openConnection() as HttpURLConnection
                    connection.requestMethod = "DELETE"
                    connection.connectTimeout = 15000
                    connection.readTimeout = 15000
                    connection.setRequestProperty("Authorization", "Bearer ${result.resultValue.accessToken}")
                    val status = connection.responseCode
                    connection.disconnect()
                    if (status == 204) {
                      account.signOut(object : AccountState.SignOutCallback {
                        override fun onResult(result: SignOutResult) {
                          promise.resolve(Arguments.createMap().apply { putString("state", "accountDeleted"); putInt("deleteStatus", status) })
                        }
                        override fun onError(error: BaseException) {
                          // Server deletion already succeeded; local cleanup is best effort.
                          promise.resolve(Arguments.createMap().apply { putString("state", "accountDeleted"); putInt("deleteStatus", status) })
                        }
                      })
                    } else {
                      promise.resolve(Arguments.createMap().apply { putString("state", "deleteRejected"); putInt("deleteStatus", status) })
                    }
                  } catch (_: Exception) {
                    promise.reject("deleteProbeFailed", "Account deletion probe failed")
                  }
                }
              }
              override fun onError(error: BaseException) {
                promise.reject("tokenFailed", "Could not acquire API token")
              }
            })
          }
          override fun onError(error: BaseException) {
            promise.reject("deleteProbeFailed", "Account deletion probe failed")
          }
        })
      } catch (_: Exception) {
        promise.reject("deleteProbeFailed", "Account deletion probe failed")
      }
    }
  }

  private fun finish(account: AccountState, promise: Promise, forceRefresh: Boolean = false) {
    val parameters = NativeAuthGetAccessTokenParameters().apply {
      scopes = listOf(API_SCOPE)
      this.forceRefresh = forceRefresh
    }
    account.getAccessToken(parameters, object : AccountState.GetAccessTokenCallback {
      override fun onResult(result: GetAccessTokenResult) {
        if (result !is GetAccessTokenResult.Complete) {
          promise.reject("tokenFailed", "Could not acquire API token")
          return
        }
        executor.execute {
          try {
            val token = result.resultValue.accessToken
            val claims = JSONObject(String(Base64.decode(token.split('.')[1], Base64.URL_SAFE or Base64.NO_WRAP)))
            val connection = URL(API_BOOTSTRAP).openConnection() as HttpURLConnection
            connection.requestMethod = "POST"
            connection.connectTimeout = 15000
            connection.readTimeout = 15000
            connection.setRequestProperty("Authorization", "Bearer $token")
            connection.setRequestProperty("Content-Type", "application/json")
            connection.doOutput = true
            // Match the production Mobile bootstrap contract; an empty body is rejected for a new user.
            val bootstrapBody = JSONObject()
              .put("preferredLocale", Locale.getDefault().toLanguageTag())
              .put("timeZoneId", TimeZone.getDefault().id)
            connection.outputStream.use { it.write(bootstrapBody.toString().toByteArray()) }
            val apiStatus = connection.responseCode
            val apiErrorCode = if (apiStatus >= 400) {
              try {
                val error = JSONObject(connection.errorStream?.bufferedReader()?.use { it.readText() } ?: "{}")
                val code = error.optString("code")
                if (code in setOf("recentAuthenticationRequired", "accountDeletionPending")) code else null
              } catch (_: Exception) { null }
            } else null
            connection.disconnect()
            promise.resolve(Arguments.createMap().apply {
              putString("state", "tokenAcquired")
              putInt("bootstrapStatus", apiStatus)
              putString("apiErrorCode", apiErrorCode)
              putBoolean("audienceMatches", claims.optString("aud") == API_AUDIENCE)
              putBoolean("issuerMatches", claims.optString("iss").contains(TENANT_ID))
              putBoolean("scopeMatches", claims.optString("scp").split(' ').contains("access_as_user"))
              putBoolean("identityPresent", claims.has("oid") && claims.has("sub"))
              putBoolean("authTimePresent", claims.has("auth_time"))
              putBoolean("oidGuid", runCatching { java.util.UUID.fromString(claims.optString("oid")) }.isSuccess)
              putBoolean("tenantGuid", runCatching { java.util.UUID.fromString(claims.optString("tid")) }.isSuccess)
              putBoolean("authTimeRecent", kotlin.math.abs(System.currentTimeMillis() / 1000 - claims.optLong("auth_time")) <= 300)
            })
          } catch (_: Exception) {
            promise.reject("apiProbeFailed", "API bootstrap probe failed")
          }
        }
      }

      override fun onError(error: BaseException) {
        promise.reject("tokenFailed", "Could not acquire API token")
      }
    })
  }
}
