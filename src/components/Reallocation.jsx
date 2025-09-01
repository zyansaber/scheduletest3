import React, { useState, useEffect } from 'react';
import { ref, set, get, push } from 'firebase/database';
import { collection, addDoc } from "firebase/firestore";
import { database, firestoreDB } from '../utils/firebase';

const Reallocation = ({ data }) => {
  const [reallocationRows, setReallocationRows] = useState([{ 
    id: 1, 
    chassisNumber: '', 
    currentVanInfo: null, 
    selectedDealer: '', 
    message: '' 
  }]);
  const [allDealers, setAllDealers] = useState([]);
  const [reallocationRequests, setReallocationRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [globalMessage, setGlobalMessage] = useState('');
  const [stats, setStats] = useState({ totalPending: 0, totalDone: 0, dealerStats: {} });
  const [showFilter, setShowFilter] = useState('all'); // 'all', 'pending', 'done'

  // Get unique dealers from data
  useEffect(() => {
    if (data && data.length > 0) {
      const dealers = [...new Set(data.map(item => item.Dealer).filter(Boolean))].sort();
      setAllDealers(dealers);
    }
  }, [data]);

  // Load reallocation requests from Firebase
  useEffect(() => {
    loadReallocationRequests();
  }, []);

  // Calculate statistics
  useEffect(() => {
    calculateStats();
  }, [reallocationRequests]);

  const loadReallocationRequests = async () => {
    try {
      const reallocationRef = ref(database, 'reallocation-bk');
      const snapshot = await get(reallocationRef);
      if (snapshot.exists()) {
        const requestsData = snapshot.val();

        const parseDateTime = (s) => {
          if (!s) return 0;
          const [datePart, timePart, ampm] = s.replace(",", "").split(" ");
          const [day, month, year] = datePart.split("/").map(Number);
          const [hoursStr, minutesStr, secondsStr] = timePart.split(":");
          let hours = parseInt(hoursStr, 10);
          const minutes = parseInt(minutesStr, 10);
          const seconds = parseInt(secondsStr, 10);
          if (ampm?.toLowerCase() === "pm" && hours < 12) hours += 12;
          if (ampm?.toLowerCase() === "am" && hours === 12) hours = 0;
          return new Date(year, month - 1, day, hours, minutes, seconds).getTime();
        };

        const requestsList = [];
        Object.entries(requestsData).forEach(([chassis, requests]) => {
          Object.entries(requests).forEach(([reqId, data]) => {
            requestsList.push({
              id: reqId,
              chassisNumber: chassis,
              ...data
            });
          });
        });

        const sortedRequests = requestsList.sort(
          (a, b) => parseDateTime(b.submitTime) - parseDateTime(a.submitTime)
        );

        setReallocationRequests(sortedRequests);
      }
    } catch (error) {
      console.error('Error loading reallocation requests:', error);
    }
  };

  const calculateStats = () => {
    const dealerStats = {};
    let totalPending = 0;
    let totalDone = 0;

    reallocationRequests.forEach(request => {
      if (request.status === 'completed') {
        totalDone++;
      } else {
        totalPending++;
      }

      if (request.originalDealer) {
        if (!dealerStats[request.originalDealer]) {
          dealerStats[request.originalDealer] = { moved_from: 0, moved_to: 0 };
        }
        dealerStats[request.originalDealer].moved_from++;
      }

      if (request.reallocatedTo) {
        if (!dealerStats[request.reallocatedTo]) {
          dealerStats[request.reallocatedTo] = { moved_from: 0, moved_to: 0 };
        }
        dealerStats[request.reallocatedTo].moved_to++;
      }
    });

    setStats({ totalPending, totalDone, dealerStats });
  };

  const handleChassisNumberChange = (rowId, chassis) => {
    const newRows = reallocationRows.map(row => {
      if (row.id === rowId) {
        if (chassis) {
          const vanInfo = data.find(item => 
            item.Chassis && item.Chassis.toLowerCase() === chassis.toLowerCase()
          );
          
          if (vanInfo) {
            const signedPlansReceived = vanInfo['Signed Plans Received'] || '';
            let message = '';
            if (signedPlansReceived.toLowerCase() === 'no') {
              message = "⚠️ The van isn't signed, please sign off or cancel to reorder";
            }
            return {
              ...row,
              chassisNumber: chassis,
              currentVanInfo: vanInfo,
              selectedDealer: '',
              message
            };
          } else {
            return {
              ...row,
              chassisNumber: chassis,
              currentVanInfo: null,
              selectedDealer: '',
              message: 'Chassis number not found'
            };
          }
        } else {
          return {
            ...row,
            chassisNumber: chassis,
            currentVanInfo: null,
            selectedDealer: '',
            message: ''
          };
        }
      }
      return row;
    });
    setReallocationRows(newRows);
  };

  const handleDealerChange = (rowId, dealer) => {
    const newRows = reallocationRows.map(row => {
      if (row.id === rowId) {
        return { ...row, selectedDealer: dealer };
      }
      return row;
    });
    setReallocationRows(newRows);
  };

  const addRow = () => {
    const newId = Math.max(...reallocationRows.map(r => r.id)) + 1;
    setReallocationRows([...reallocationRows, { 
      id: newId, 
      chassisNumber: '', 
      currentVanInfo: null, 
      selectedDealer: '', 
      message: '' 
    }]);
  };

  const removeRow = (rowId) => {
    if (reallocationRows.length > 1) {
      setReallocationRows(reallocationRows.filter(row => row.id !== rowId));
    }
  };

  const getMelbourneTime = () => {
    return new Date().toLocaleString('en-AU', {
      timeZone: 'Australia/Melbourne',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

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

        // Save as a new entry (not overwrite)
        const reallocationRef = ref(database, `reallocation-bk/${chassis}`);
        const newRequestRef = push(reallocationRef);
        await set(newRequestRef, reallocationData);

        // Queue email in Firestore
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
      setReallocationRows([{
        id: 1,
        chassisNumber: '',
        currentVanInfo: null,
        selectedDealer: '',
        message: ''
      }]);

      await loadReallocationRequests();
    } catch (error) {
      console.error('❌ Error submitting reallocation requests:', error);
      setGlobalMessage('Error submitting requests. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleMarkDone = async (chassisNumber, requestId) => {
    try {
      const reallocationRef = ref(database, `reallocation-bk/${chassisNumber}/${requestId}/status`);
      await set(reallocationRef, 'completed');
      await loadReallocationRequests();
      setGlobalMessage('Reallocation marked as completed');
    } catch (error) {
      console.error('❌ Error marking reallocation as done:', error);
      setGlobalMessage('Error updating status. Please try again.');
    }
  };

  const handleIssueUpdate = async (chassisNumber, requestId, issueType) => {
    try {
      const issueRef = ref(database, `reallocation-bk/${chassisNumber}/${requestId}/issue`);
      await set(issueRef, {
        type: issueType,
        timestamp: getMelbourneTime()
      });

      await addDoc(collection(firestoreDB, "reallocation_mail"), {
        to: ["dongning@regentrv.com.au"],
        message: {
          subject: `New Issue: Chassis ${chassisNumber}`,
          html: `Chassis number <strong>${chassisNumber}</strong> has been marked as <strong>${issueType}</strong>.`,
        },
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
    if (status.toLowerCase() === 'finished') return false;
    if (signedPlansReceived.toLowerCase() === 'no') return false;
    return true;
  };

  const getRowStatus = (row) => {
    if (!row.currentVanInfo) return '';
    const status = row.currentVanInfo['Regent Production'] || '';
    const signedPlansReceived = row.currentVanInfo['Signed Plans Received'] || '';
    if (status.toLowerCase() === 'finished') {
      return 'The van was dispatched - cannot reallocate';
    }
    if (signedPlansReceived.toLowerCase() === 'no') {
      return 'Cannot submit - van is not signed';
    }
    return '';
  };

  const canSubmitAnyRow = () => {
    return reallocationRows.some(row => canSubmitRow(row));
  };

  const filteredRequests = reallocationRequests.filter(request => {
    if (showFilter === 'pending') return request.status !== 'completed';
    if (showFilter === 'done') return request.status === 'completed';
    return true;
  });

  const downloadCSV = () => {
    const headers = ['Chassis', 'From Dealer', 'To Dealer', 'Van Status', 'Signed Plans', 'Submit Time', 'Request Status', 'Issue Type', 'Issue Time'];
    const csvData = [
      headers,
      ...filteredRequests.map(request => [
        request.chassisNumber,
        request.originalDealer,
        request.reallocatedTo,
        request.status === 'completed' ? 'Done' : request.status,
        request.signedPlansReceived || 'N/A',
        request.submitTime,
        request.status === 'completed' ? 'Completed' : 'Pending',
        request.issue?.type || 'None',
        request.issue?.timestamp || 'N/A'
      ])
    ];
    const csvContent = csvData.map(row => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `reallocation_requests_${showFilter}_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="p-4 max-w-7xl mx-auto">
      {/* ... keep the rest of your JSX the same, but update action handlers below */}
      {/* In request table rows, pass request.id to actions */}
      <tbody className="bg-white divide-y divide-gray-200">
        {filteredRequests.map((request, index) => (
          <tr key={index} className="hover:bg-gray-50">
            {/* ... other columns ... */}
            <td className="px-4 py-2 text-sm text-gray-500">
              {request.issue ? (
                <div className="text-xs">
                  <div className="px-2 py-1 rounded text-white text-center">
                    {request.issue.type}
                  </div>
                  <div className="text-gray-400 mt-1">{request.issue.timestamp}</div>
                </div>
              ) : (
                <select
                  onChange={(e) => {
                    if (e.target.value) {
                      handleIssueUpdate(request.chassisNumber, request.id, e.target.value);
                      e.target.value = '';
                    }
                  }}
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
              {request.status !== 'completed' && (
                <button
                  onClick={() => handleMarkDone(request.chassisNumber, request.id)}
                  className="bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded text-xs font-medium"
                >
                  Done
                </button>
              )}
              {request.status === 'completed' && (
                <span className="text-green-600 text-xs font-medium">✓ Completed</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </div>
  );
};

export default Reallocation;
