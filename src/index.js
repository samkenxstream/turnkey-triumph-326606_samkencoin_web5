import React, { Component, Fragment, useState, useEffect, useRef } from 'react'
import PropTypes from 'prop-types'
import Web3 from 'web3'

import { useThrottled } from './utilities'
import * as utilities from './web3Utilities'
import { Initializing, NoWeb3, PermissionNeeded, UnlockNeeded, UnsupportedNetwork, Web3Error } from './defaultScreens'


// define custom error codes
const ETHEREUM_ACCESS_DENIED = 'ETHEREUM_ACCESS_DENIED'
const NO_WEB3 = 'NO_WEB3'

// web3 manager
const {
  setEthereumVariables,
  ...utilitiesToInject
} = utilities
const initialWeb3State = { web3js: undefined, account: undefined, networkId: undefined}

function useWeb3Manager (pollTime) {
  // web3 state
  const [web3State, setWeb3State] = useState(initialWeb3State)
  function setWeb3StateIndividually (newState) {
    setWeb3State({...web3State, ...newState})
  }

  // set state in utilities
  setEthereumVariables(web3State)

  // compute initialization status
  const web3Initialized = web3State.web3js && web3State.account !== undefined && web3State.networkId

  // web3 error ref
  const web3Error = useRef(null)
  function setWeb3Error (error) {
    web3Error.current = error
  }
  useEffect(() => {
    if (web3Initialized) web3Error.current = null
  })

  // run one-time initialization effect
  useEffect(async () => {
    const { web3, ethereum } = window

    // initialize web3js
    let web3js
    let error
    // for modern dapp browsers
    if (ethereum)
      await ethereum.enable()
        .then(() => {
          web3js = new Web3(ethereum)
        })
        .catch(deniedAccessMessage => {
          const deniedAccessError = Error(deniedAccessMessage.toString())
          deniedAccessError.code = ETHEREUM_ACCESS_DENIED
          error = deniedAccessError
        })
    // for legacy dapp browsers
    else if (web3 && web3.currentProvider)
      web3js = new Web3(web3.currentProvider)
    // no web3 detected
    else {
      const noWeb3Error = Error('No Web3 Provider Detected.')
      noWeb3Error.code = NO_WEB3
      error = noWeb3Error
    }

    if (error)
      setWeb3Error(error)
    else {
      setWeb3StateIndividually({web3js: web3js})
    }
  }, [])

  function networkPoll () {
    web3State.web3js.eth.net.getId()
      .then(networkId => {
        if (networkId !== web3State.networkId) setWeb3StateIndividually({networkId: networkId})
      })
      .catch(error => setWeb3Error(error))
  }
  const throttledNetworkPoll = useThrottled(networkPoll, pollTime * 5)

  function accountPoll () {
    web3State.web3js.eth.getAccounts()
      .then(accounts => {
        const account = (accounts === undefined || accounts[0] === undefined) ? null : accounts[0]
        if (account !== web3State.account) setWeb3StateIndividually({account: account})
      })
      .catch(error => setWeb3Error(error))
  }
  const throttledAccountPoll = useThrottled(accountPoll, pollTime)

  useEffect(() => {
    if (web3State.web3js) {
      networkPoll()
      const networkPollInterval = setInterval(throttledNetworkPoll, pollTime)
      return () => clearInterval(networkPollInterval)
    }
  }, [web3State.web3js, web3State.networkId])

  useEffect(() => {
    if (web3State.web3js) {
      accountPoll()
      const accountPollInterval = setInterval(throttledAccountPoll, pollTime)
      return () => clearInterval(accountPollInterval)
    }
  }, [web3State.web3js, web3State.account])

  // rerenderers
  const [accountRerenderer, setAccountRerenderer] = useState(0)
  function forceAccountRerender () {
    setAccountRerenderer(accountRerenderer + 1)
  }
  const [networkRerenderer, setNetworkRerenderer] = useState(0)
  function forceNetworkRerender () {
    setNetworkRerenderer(networkRerenderer + 1)
  }

  return [
    {...web3State, utilities: utilitiesToInject}, web3Initialized, web3Error.current,
    { accountRerenderer, forceAccountRerender, networkRerenderer, forceNetworkRerender }
  ]
}


// web3 provider
export const Web3Context = React.createContext()

function Web3Provider(props) {
  const { screens, pollTime, supportedNetworks, children } = props
  const { Web3Error, Initializing, UnsupportedNetwork, PermissionNeeded, UnlockNeeded } = screens

  const [
    web3State, web3Initialized, web3Error,
    { accountRerenderer, forceAccountRerender, networkRerenderer, forceNetworkRerender }
  ] = useWeb3Manager(pollTime)

  if (web3Error) {
    if (web3Error.code === ETHEREUM_ACCESS_DENIED)
      return <PermissionNeeded />
    else if (web3Error.code === NO_WEB3)
      return <NoWeb3 />
    else
      return <Web3Error error={web3Error} />
  }

  if (!web3Initialized)
    return <Initializing />

  if (!supportedNetworks.includes(web3State.networkId)) {
    const supportedNetworkNames = supportedNetworks.map(id => web3State.utilities.getNetworkName(id))
    return <UnsupportedNetwork supportedNetworkNames={supportedNetworkNames} />
  }

  if (web3State.account === null)
    return <UnlockNeeded />

  return (
    <Web3Context.Provider
      value={{...web3State, accountRerenderer, forceAccountRerender, networkRerenderer, forceNetworkRerender}}
    >
      {children}
    </Web3Context.Provider>
  )
}

const screens = {
  Initializing:       PropTypes.any,
  NoWeb3:             PropTypes.any,
  PermissionNeeded:   PropTypes.any,
  UnlockNeeded:       PropTypes.any,
  UnsupportedNetwork: PropTypes.any,
  Web3Error:          PropTypes.any
}

const defaultScreens = {
  Initializing:       Initializing,
  NoWeb3:             NoWeb3,
  PermissionNeeded:   PermissionNeeded,
  UnlockNeeded:       UnlockNeeded,
  UnsupportedNetwork: UnsupportedNetwork,
  Web3Error:          Web3Error
}

const web3ProviderPropTypes = {
  screens:           PropTypes.shape(screens),
  pollTime:          PropTypes.number,
  supportedNetworks: PropTypes.arrayOf(PropTypes.number),
  children:          PropTypes.node
}

const web3ProviderDefaultProps = {
  screens:           defaultScreens,
  pollTime:          1000,
  supportedNetworks: [1, 3, 4, 42],
  children:          ''
}

Web3Provider.propTypes = web3ProviderPropTypes
Web3Provider.defaultProps = web3ProviderDefaultProps


// error boundary
class Web3ReactErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: undefined }
  }

  static getDerivedStateFromError(error) {
    return { error: error }
  }

  componentDidCatch(error) {
    console.error(error) // eslint-disable-line no-console
  }

  render() {
    const { ErrorScreen, children } = this.props
    if (this.state.error) return <ErrorScreen error={this.state.error} />
    return children
  }
}

Web3ReactErrorBoundary.propTypes = {
  ErrorScreen: PropTypes.any.isRequired,
  children:    PropTypes.node.isRequired
}


// web3 provider wrapped in error boundary
function WrappedWeb3Provider(props) {
  const { screens } = props
  const { Web3Error } = screens

  return (
    <Web3ReactErrorBoundary ErrorScreen={Web3Error}>
      <Web3Provider {...props} />
    </Web3ReactErrorBoundary>
  )
}

WrappedWeb3Provider.propTypes = web3ProviderPropTypes
WrappedWeb3Provider.defaultProps = web3ProviderDefaultProps

export default WrappedWeb3Provider


// render props pattern: the consumer is exposed to give access to the web3 context via render props
function Web3Consumer (props) {
  const { recreateOnNetworkChange, recreateOnAccountChange, children } = props

  return (
    <Web3Context.Consumer>
      {context => (
        <Fragment key={recreateOnNetworkChange ? context.networkId : undefined}>
          <Fragment key={recreateOnAccountChange ? context.account : undefined}>
            {children(context)}
          </Fragment>
        </Fragment>
      )}
    </Web3Context.Consumer>
  )
}

Web3Consumer.propTypes = {
  recreateOnNetworkChange: PropTypes.bool,
  recreateOnAccountChange: PropTypes.bool,
  children:                PropTypes.func.isRequired
}

Web3Consumer.defaultProps = {
  recreateOnAccountChange: true,
  recreateOnNetworkChange: true
}

export { Web3Consumer }


// HOC pattern: withWeb3 is an wrapper that gives passed components access to the web3 context
export function withWeb3(ComponentToWrap, props) {
  const { recreateOnNetworkChange, recreateOnAccountChange } = props || {}

  class WithWeb3 extends Component {
    render() {
      return (
        <Web3Consumer
          recreateOnNetworkChange={recreateOnNetworkChange || true}
          recreateOnAccountChange={recreateOnAccountChange || true}
        >
          {context => <ComponentToWrap {...this.props} web3={context} />}
        </Web3Consumer>
      )
    }
  }

  WithWeb3.displayName = `WithWeb3(${ComponentToWrap.displayName || ComponentToWrap.name || 'Component'})`

  return WithWeb3
}