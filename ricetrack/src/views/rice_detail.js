'use strict'

const m = require('mithril')
const moment = require('moment')
const {
    getPropertyValue,
    getLatestPropertyUpdateTime,
    getOldestPropertyUpdateTime,
} = require('../utils/records')
const api = require('../services/api')
const parsing = require('../services/parsing')
const payloads = require('../services/payloads');
const transactions = require('../services/transactions')
const { authorizeReporter } = require('./reporterUtils');
const { BasicModal, show } = require('../components/modals')


const _formatTimestamp = (sec) => {
    if (!sec) {
        sec = Date.now() / 1000
    }
    return moment.unix(sec).format('YYYY-MM-DD')
}

const _labelProperty = (label, value) => [
    m('dl', m('dt', label), m('dd', value))
]

const _row = (...cols) =>
    m('.row', cols.filter((col) => col !== null).map((col) => m('.col', col)))

const _agentLink = (agent) =>
    m(`a[href=/agents/${agent.key}]`, { oncreate: m.route.link }, agent.name)

const _propLink = (record, propName, content) =>
    m(`a[href=/properties/${record.recordId}/${propName}]`,
        { oncreate: m.route.link },
        content)

const _formatDateTime = (timestamp) => {
    const seconds = timestamp / 1000 // Konversi dari milidetik ke detik
    return moment.unix(seconds).format('DD-MM-YYYY HH:mm')
}

const _formatDate = (timestamp) => {
    const seconds = timestamp / 1000; // Konversi dari milidetik ke detik
    return moment.unix(seconds).format('DD-MM-YYYY')
}

const ROLE_TO_ENUM = {
    'owner': payloads.createProposal.enum.OWNER,
    'custodian': payloads.createProposal.enum.CUSTODIAN,
    'reporter': payloads.createProposal.enum.REPORTER
  }
  
const _getProposal = (record, receivingAgent, role) => {
    if (!record.proposals) {
        return null;
    }

    return record.proposals.find(
        (proposal) => {
            return (proposal.role.toLowerCase() === role.toLowerCase() && proposal.receivingAgent === receivingAgent)
        })
}
const _hasProposal = (record, receivingAgent, role) =>
    !!_getProposal(record, receivingAgent, role)

const _answerProposal = (record, publicKey, role, response) => {
    console.log('Response:', response)
    console.log('Role:', role)
    console.log('Public key:', publicKey)

    let answerPayload = payloads.answerProposal({
        recordId: record.recordId,
        receivingAgent: publicKey,
        role,
        response
    })
    console.log('?Record:', record)
    console.log('Answer payload:', answerPayload);
    console.log('Payloads answerProposal:', payloads.answerProposal.enum.ACCEPT)

    return transactions.submit([answerPayload], true).then(() => {
        console.log('Successfully submitted answer')
/*
        if (response === payloads.answerProposal.enum.ACCEPT) {
            // Update role based on accepted proposal
            if (role === 'owner') {
                state.record.owner = publicKey;
            } else if (role === 'custodian') {
                state.record.custodian = publicKey;
            } else if (role === 'reporter') {
                console.log('Authorizing reporter')
                console.log('Properties:', record.proposals[0].properties)
                console.log('Public key:', publicKey)
                console.log('Role:', role)
                // state.record.reporters = 
                // authorizeReporter(record, publicKey, role, record.proposals[0].properties)

            }
        }
        */
        m.redraw(); // Trigger a redraw to update the UI
    })
        .catch((error) => {
            console.error('Error submitting transaction:', error);
        });
}

const RiceDetail = {
    oninit(vnode) {
        vnode.state.showModal = true;
        _loadData(vnode.attrs.recordId, vnode.state)
        vnode.state.refreshId = setInterval(() => {
            _loadData(vnode.attrs.recordId, vnode.state)
        }, 2000)
    },

    onbeforeremove(vnode) {
        clearInterval(vnode.state.refreshId)
    },

    view(vnode) {
        if (!vnode.state.record) {
            return m('.alert-warning', `Loading ${vnode.attrs.recordId}`)
        }

        let record = vnode.state.record
        let owner = vnode.state.owner
        let custodian = vnode.state.custodian
        let publicKey = api.getPublicKey()
        let proposals = vnode.state.record.proposals

        // Check for proposals and prompt for action
        if ((vnode.state.showModal) && (_hasProposal(record, publicKey, 'owner') || _hasProposal(record, publicKey, 'custodian') || _hasProposal(record, publicKey, 'reporter'))) {
            vnode.state.showModal = false;
            let role;
            if (_hasProposal(record, publicKey, 'owner')) {
                role = 'owner';
            } else if (_hasProposal(record, publicKey, 'custodian')) {
                role = 'custodian';
            } else if (_hasProposal(record, publicKey, 'reporter')) {
                role = 'reporter';
            }

            show(BasicModal, {
                title: 'Proposal Pending',
                body: m('p', `You have a pending proposal for this record as a ${role}. Do you want to accept it?`),
                acceptText: 'Yes',
                cancelText: 'No'
            }).then(() => {
                console.log('Accepted proposal')
                _answerProposal(record, publicKey, ROLE_TO_ENUM[role], payloads.answerProposal.enum.ACCEPT)
            }).catch(() => {
                console.log('Rejected proposal')
                _answerProposal(record, publicKey, ROLE_TO_ENUM[role], payloads.answerProposal.enum.REJECT)
            });

        }
        return [
            m('.rice-detail',
                m('h1.text-center', record.recordId),
                _row(
                    _labelProperty('Created', _formatTimestamp(getOldestPropertyUpdateTime(record))),
                    _labelProperty('Updated', _formatTimestamp(getLatestPropertyUpdateTime(record)))
                ),

                _row(
                    _labelProperty('Owner', _agentLink(owner)),
                    _labelProperty('Custodian', _agentLink(custodian))
                ),

                _row(
                    _labelProperty('Tanggal Transaksi Terakhir', _formatDateTime(getPropertyValue(record, 'tgltransaksi', 0))),
                    _labelProperty('Kedaluwarsa', _formatDate(getPropertyValue(record, 'kedaluwarsa', 0)))),

                _row(
                    _labelProperty('Varietas', getPropertyValue(record, 'varietas')),
                    _labelProperty('Berat (kg)', getPropertyValue(record, 'berat', 0))),

                _row(
                    _labelProperty(
                        'Harga', vnode.state.record ? _formatValue(vnode.state.record, 'harga') : 'Loading...'),
                    _labelProperty(
                        'Lokasi',
                        _propLink(record, 'lokasi', _formatLocation(getPropertyValue(record, 'lokasi'))))),

                // Navigation buttons with role-based visibility
                m('.row.m-2',
                    m('.col.text-center',
                        m('button.btn.btn-primary', {
                            onclick: () => m.route.set(`/rice-updates/${record.recordId}`)
                        }, 'Lacak'),

                        record.owner === publicKey && !record.final ?
                            m('button.btn.btn-primary', {
                                onclick: () => m.route.set(`/transfer-ownership/${record.recordId}`)
                            }, 'Jual') : null,

                        record.custodian === publicKey && !record.final ?
                            m('button.btn.btn-primary', {
                                onclick: () => m.route.set(`/update-properties/${record.recordId}`)
                            }, 'Update Properties') : null,

                        (record.owner === publicKey || record.custodian === publicKey) && !record.final ?
                            m('button.btn.btn-primary', {
                                onclick: () => m.route.set(`/manage-reporters/${record.recordId}`)
                            }, 'Kelola Reporters') : null,
                    )
                )
            )
        ]
    }
}

const _formatValue = (record, propName) => {
    let prop = getPropertyValue(record, propName)
    if (prop) {
        return `Rp ${parseInt(prop).toLocaleString('id')}`;
    } else {
        return 'N/A'
    }
}

const _formatLocation = (lokasi) => {
    if (lokasi && lokasi.latitude !== undefined && lokasi.longitude !== undefined) {
        let latitude = parsing.toFloat(lokasi.latitude)
        let longitude = parsing.toFloat(lokasi.longitude)
        return `${latitude}, ${longitude}`
    } else {
        return 'Unknown'
    }
}

const _loadData = (recordId, state) => {
    let publicKey = api.getPublicKey()
    return api.get(`records/${recordId}`)
        .then(record =>
            Promise.all([
                record,
                api.get('agents')]))
        .then(([record, agents]) => {
            state.record = record
            state.agents = agents.filter((agent) => agent.key !== publicKey)
            state.owner = agents.find((agent) => agent.key === record.owner)
            state.custodian = agents.find((agent) => agent.key === record.custodian)
        })
}

module.exports = RiceDetail
