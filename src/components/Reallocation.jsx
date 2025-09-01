import React, { useState, useEffect } from 'react';
import { ref, set, get, push } from 'firebase/database';
import { collection, addDoc } from "firebase/firestore";
import { database, firestoreDB } from '../utils/firebase';

const Reallocation = ({ data }) => {
  const [reallocationRows, setReallocationRows] = useState([{ 
    id: 1, chassisNumber: '', currentVanInfo: null, selectedDealer: '', message: '' 
  }]);
  const [allDealers, setAllDealers] = useState([]);
  const [reallocationRequests, setReallocationRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [globalMessage, setGlobalMessage] = useState('');
  const [stats, setStats] = useState({ totalPending: 0, totalDone: 0, dealerStats: {} });
  const [showFilter, setShowFilter] = useState('all'); // 'all', 'pending', 'done'

  // Get unique dealers
  useEffect(() => {
    if (data && data.length > 0) {
      const dealers = [...new Set(data.map(item => item.Dealer).filter(Boolean))].sort();
      setAllDealers(dealers);
    }
  }, [data]);

  // Load requests on mount
  useEffect(() => {
    loadReallocationRequests();
  }, []);

  // Recalculate stats
  useEffect(() => {
    calculateStats();
  }, [reallocationRequests]);

  // --- Load all reallocations ---
  const loadReallocationRequests = async () => {
    try {
      const reallocationRef = ref(database, 'reallocation-bk');
      const snapshot = await get(reallocationRef);

      if (snapshot.exists()) {
        const requestsData = snapshot.val();

        // Flatten { chassis: { pushId: record } }
        const requestsList = Object.entries(requestsData).flatMap(([chassis, records]) =>
          Object.entries(records).map(([id, data]) => ({
            id,
            chassisNumber: chassis,
            ...data
          }))
        ).sort((a, b) => new Date(b.submitTime) - new Date(a.submitTime));

        setReallocationRequests(requestsList);
      } else {
        setReallocationRequests([]);
      }
    } catch (error) {
      console.error('Error loading reallocation requests:', error);
    }
  };

  // --- Stats calculation ---
  const calculateStats = () => {
    const dealerStats = {};
    let totalPending = 0;
    let totalDone = 0;

    reallocationRequests.forEach(request => {
      if (request.status === 'completed') totalDone++; else totalPending++;
      if (request.originalDealer) {
        dealerStats[request.originalDealer] = dealerStats[request.originalDealer] || { moved_from: 0, moved_to: 0 };
        dealerStats[request.originalDealer].moved_from++;
      }
      if (request.reallocatedTo) {
        dealerStats[request.reallocatedTo] = dealerStats[request.reallocatedTo] || { moved_from: 0, moved_to: 0 };
        dealerStats[request.reallocatedTo].moved_to++;
      }
    });

    setStats({ totalPending, totalDone, dealerStats });
  };

  const handleChassisNumberChange = (rowId, chassis) => {
    const newRows = reallocationRows.map(row => {
      if (row.id === rowId) {
        if (chassis) {
          const vanInfo = data.find(item => item.Chassis && item.Chassis.toLowerCase() === chassis.toLowerCase());
          if (vanInfo) {
            const signedPlansReceived = vanInfo['Signed Plans Received'] || '';
            let message = signedPlansReceived.toLowerCase() === 'no'
              ? "⚠️ The van isn't signed, please sign off or cancel to reorder"
              : '';
            return { ...row, chassisNumber: chassis, currentVanInfo: vanInfo, selectedDealer: '', message };
          } else {
            return { ...row, chassisNumber: chassis, currentVanInfo: null, selectedDealer: '', message: 'Chassis number not found' };
          }
        } else {
          return { ...row, chassisNumber: chassis, currentVanInfo: null, selectedDealer: '', message: '' };
        }
      }
      return row;
    });
    setReallocationRows(newRows);
  };

  const handleDealerChange = (rowId, dealer) => {
    setReallocationRows(reallocationRows.map(row => row.id === rowId ? { ...row, selectedDealer: dealer } : row));
  };

  const addRow = () => {
    const newId = Math.max(...reallocationRows.map(r => r.id)) + 1;
    setReallocationRows([...reallocationRows, { id: newId, chassisNumber: '', currentVanInfo: null, selectedDealer: '', message: '' }]);
  };

  const removeRow = (rowId) => {
    if (reallocationRows.length > 1) setReallocationRows(reallocationRows.filter(row => row.id !== rowId));
  };

  const getMelbourneTime = () => new Date().toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // --- Submit reallocations ---
  const handleSubmit = async () => {
    const validRows = reallocationRows.filter(row => canSubmitRow(row));
    if (validRows.length === 0) {
      setGlobalMessage('Please enter valid chassis numbers and select dealers for at least one row');
      return;
    }

    setLoading(true);
    try {
      const promises = validRows.map(async (row) => {
        const chassis = row.chassisNumber || 'Unknown';
        const dealer = row.selectedDealer || 'Unknown';
        const currentVan = row.currentVanInfo || {};

        const reallocationData = {
          status: currentVan['Regent Production'] || 'Unknown',
          originalDealer: currentVan.Dealer || 'Unknown',
          reallocatedTo: dealer,
          submitTime: getMelbourneTime(),
          model: currentVan.Model || '',
          customer: currentVan.Customer || '',
          signedPlansReceived: currentVan['Signed Plans Received'] || ''
        };

        // Push new record
        const reallocationRef = ref(database, `reallocation-bk/${chassis}`);
        await push(reallocationRef, reallocationData);

        // Firestore email
        await addDoc(collection(firestoreDB, "reallocation_mail"), {
          to: ["dongning@regentrv.com.au"],
          message: {
            subject: `New Reallocation Request: Chassis ${chassis}`,
            text: `Chassis number ${chassis} has been requested to dealer ${dealer}.`,
            html: `Chassis number <strong>${chassis}</strong> has been requested to dealer <strong>${dealer}</strong>.`,
          },
        });
      });

      await Promise.all(promises);

      setGlobalMessage(`Successfully submitted ${validRows.length} reallocation request(s)!`);
      setReallocationRows([{ id: 1, chassisNumber: '', currentVanInfo: null, selectedDealer: '', message: '' }]);
      await loadReallocationRequests();
    } catch (error) {
      console.error('❌ Error submitting reallocation requests:', error);
      setGlobalMessage('Error submitting requests. Please try again.');
    } finally { setLoading(false); }
  };

  const handleMarkDone = async (chassisNumber, id) => {
    try {
      const reallocationRef = ref(database, `reallocation-bk/${chassisNumber}/${id}/status`);
      await set(reallocationRef, 'completed');
      await loadReallocationRequests();
      setGlobalMessage('Reallocation marked as completed');
    } catch (error) {
      console.error('❌ Error marking reallocation as done:', error);
      setGlobalMessage('Error updating status. Please try again.');
    }
  };

  const handleIssueUpdate = async (chassisNumber, id, issueType) => {
    try {
      const issueRef = ref(database, `reallocation-bk/${chassisNumber}/${id}/issue`);
      await set(issueRef, { type: issueType, timestamp: getMelbourneTime() });

      await addDoc(collection(firestoreDB, "reallocation_mail"), {
        to: ["dongning@regentrv.com.au"],
        message: { subject: `New Issue: Chassis ${chassisNumber}`, html: `Chassis number <strong>${chassisNumber}</strong> has been marked as <strong>${issueType}</strong>.` },
      });

      await loadReallocationRequests();
      setGlobalMessage(`Issue "${issueType}" recorded for ${chassisNumber}`);
    } catch (error) {
      console.error('Error updating issue:', error);
      setGlobalMessage('Error recording issue. Please try again.');
    }
  };

  const canSubmitRow = (row) => {
    if (!row.currentVanInfo || !row.selectedDealer) return false;
    const status = row.currentVanInfo['Regent Production'] || '';
    const signedPlansReceived = row.currentVanInfo['Signed Plans Received'] || '';
    return status.toLowerCase() !== 'finished' && signedPlansReceived.toLowerCase() !== 'no';
  };

  const canSubmitAnyRow = () => reallocationRows.some(row => canSubmitRow(row));

  const filteredRequests = reallocationRequests.filter(request => {
    if (showFilter === 'pending') return request.status !== 'completed';
    if (showFilter === 'done') return request.status === 'completed';
    return true;
  });

  // --- Table now shows all records, even duplicates ---
  return (
    <div className="p-4 max-w-7xl mx-auto">
      <h2 className="text-2xl font-semibold mb-4 text-gray-800">Dealer Reallocation</h2>

      {/* Reallocation Form */}
      <div className="bg-white rounded-lg shadow-sm p-4 mb-4">
        {/* Rows & submit form code here (same as your current form, unchanged) */}
      </div>

      {/* Reallocation Requests Table */}
      <div className="bg-white rounded-lg shadow-sm p-4">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-700">Reallocation Requests</h3>
        </div>

        {filteredRequests.length === 0 ? (
          <div className="text-center text-gray-500 py-4">
            No {showFilter === 'all' ? '' : showFilter} reallocation requests
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-white uppercase bg-blue-600">Chassis</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">From</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-white uppercase bg-blue-600">To</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Signed Plans</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Submit Time</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Issue</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredRequests.map((request) => (
                  <tr key={request.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-sm font-semibold text-blue-700 bg-blue-50">{request.chassisNumber}</td>
                    <td className="px-4 py-2 text-sm text-gray-500">{request.originalDealer}</td>
                    <td className="px-4 py-2 text-sm font-semibold text-blue-700 bg-blue-50">{request.reallocatedTo}</td>
                    <td className="px-4 py-2 text-sm text-gray-500">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                        request.status === 'completed' ? 'bg-green-100 text-green-800' :
                        request.status === 'finished' ? 'bg-blue-100 text-blue-800' :
                        'bg-yellow-100 text-yellow-800'
                      }`}>{request.status === 'completed' ? 'Done' : request.status}</span>
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-500">{request.signedPlansReceived || 'N/A'}</td>
                    <td className="px-4 py-2 text-sm text-gray-500">{request.submitTime}</td>
                    <td className="px-4 py-2 text-sm text-gray-500">
                      {request.issue ? (
                        <div className="text-xs px-2 py-1 rounded bg-gray-200">{request.issue.type} <br /> {request.issue.timestamp}</div>
                      ) : (
                        <select
                          onChange={(e) => { if (e.target.value) { handleIssueUpdate(request.chassisNumber, request.id, e.target.value); e.target.value = ''; } }}
                          className="text-xs border border-gray-300 rounded px-1 py-1"
                        >
                          <option value="">Select Issue</option>
                          <option value="SAP Issue">SAP Issue</option>
                          <option value="Invoice Issue">Invoice Issue</option>
                          <option value="Dispatched Status Issue">Dispatched Status Issue</option>
                        </select>
                      )}
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-500">
                      {request.status !== 'completed' ? (
                        <button
                          onClick={() => handleMarkDone(request.chassisNumber, request.id)}
                          className="bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded text-xs font-medium"
                        >Done</button>
                      ) : (
                        <span className="text-green-600 text-xs font-medium">✓ Completed</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default Reallocation;
