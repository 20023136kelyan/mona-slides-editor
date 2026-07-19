import axios from 'axios'
import message from '@/utils/message'
import { translate } from '@/i18n'

const instance = axios.create({ timeout: 1000 * 300 })

instance.interceptors.response.use(
  response => {
    if (response.status >= 200 && response.status < 400) {
      return Promise.resolve(response.data)
    }

    message.error(translate('runtime.requestUnknown'))
    return Promise.reject(response)
  },
  error => {
    if (error && error.response) {
      if (error.response.status >= 400 && error.response.status < 500) {
        return Promise.reject(error.message)
      }
      else if (error.response.status >= 500) {
        return Promise.reject(error.message)
      }
      
      message.error(translate('runtime.serverUnknown'))
      return Promise.reject(error.message)
    }

    message.error(translate('runtime.serverUnavailable'))
    return Promise.reject(error)
  }
)

export default instance
