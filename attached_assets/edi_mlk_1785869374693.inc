<?php

class Sirius_Smf_Report_Edi_MLK extends Sirius_Trust_Provider_Edi_Report_Generator {
  public $type = 'sirius-smf-edi-mlk';

  public function benefit_nid() { return $this->benefit_nid_from_id('M'); }

  public function info($result = array()) {
    $result = array(
      'name' => t('EDI - MLK'),
      'description' => '',
      'access' => 'sirius trust staff',
      'module' => 'sirius_smf',
      'file' => 'reports/edi_mlk.inc',
      'row_encoding' => 'json',
      'edi_tiers' => array('blended'),
      'edi_output_format' => 'csv',
    );

    return parent::info($result);
  }

  public function edi_premium_tier($context) {
    if (!($this->is_subscriber($context))) { return NULL; }
    return 'blended';
  }

  public function edi_fields() {
    $fields = array();
    $fields['POLICY'] = array();
    $fields['PLAN'] = array();
    $fields['GROUP'] = array();
    $fields['FILE DT'] = array();
    $fields['MEM ACCT'] = array();
    $fields['DEP ACCT'] = array();
    $fields['MEM/DEP'] = array();
    $fields['LN'] = array();
    $fields['FN'] = array();
    $fields['MI'] = array();
    $fields['DEP REL'] = array();
    $fields['BD'] = array();
    $fields['SEX'] = array();
    $fields['SSN'] = array();
    $fields['DEP SSN'] = array();
    $fields['PHONE'] = array();
    $fields['ADDR1'] = array();
    $fields['ADDR2'] = array();
    $fields['CITY'] = array();
    $fields['ST'] = array();
    $fields['ZIP'] = array();
    $fields['EFF DT'] = array();
    $fields['TERM DT'] = array();
    $fields['PCP'] = array();
    $fields['LOB'] = array();
    $fields['ERN'] = array();
    $fields['EMPLOYER'] = array();
    $fields['EMAIL'] = array();
    return $fields;
  }

  public function batch($workers, $values, &$batch_context) {
    $benefit_nid = $this->benefit_nid();

    $asof_date = date('Y-m-d 00:00:00', strtotime($values['parameters']['asof_date']));

    $rows = array();
    foreach ($workers as $worker_nid => $worker) {
      $wb_nid = $worker['wb_nid'];
      $context = $this->context($worker, $asof_date, $values['parameters']);
      if (!$context['worker_node']) { continue; }

      $row = array();

      $row['POLICY'] = 'MLKH';
      $row['PLAN'] = '1';
      $row['GROUP'] = 'SMC';
      $row['FILE DT'] = date('Ymd');
      $row['MEM ACCT'] = $this->mlk_acct($context, 'subscriber_node');
      $row['DEP ACCT'] = $this->mlk_acct($context, 'worker_node');
      $row['MEM/DEP'] = $this->memdep($context);
      $row['LN'] = $context['worker_node']->field_sirius_name['und'][0]['family'];
      $row['FN'] = $context['worker_node']->field_sirius_name['und'][0]['given'];
      $row['MI'] = substr($context['worker_node']->field_sirius_name['und'][0]['middle'], 0, 1);
      $row['DEP REL'] = $this->deprel($context);
      $row['BD'] = $this->dob($context, 'worker_node');
      $row['SEX'] = $this->gender($context);
      $row['SSN'] = $this->ssn($context, 'subscriber_node');
      $row['DEP SSN'] = $this->ssn($context, 'worker_node');
      $row['PHONE'] = $this->mlk_column($context, 'phone');
      $row['ADDR1'] = $this->mlk_column($context, 'thoroughfare');
      $row['ADDR2'] = $this->mlk_column($context, 'premise'); 
      $row['CITY'] = $this->mlk_column($context, 'locality');
      $row['ST'] = $this->mlk_column($context, 'administrative_area');
      $row['ZIP'] = $this->mlk_column($context, 'zip');
      $row['EFF DT'] = $this->coverage_start_date($context);
      $row['TERM DT'] =  $this->coverage_end_date($context);
      $row['PCP'] = '';
      $row['LOB'] = 'COMMERCIAL';
      $row['ERN'] = 'C0991';
      $row['EMPLOYER'] = '';
      $row['EMAIL'] = $this->email($context, 'worker_node');

      $row = $this->edi_row($row, $context);

      $rows[$context['pk']] = $row;
    }

    return array('is_multiple' => TRUE, 'rows' => $rows);
  }

  public function mlk_column($context, $column) {
    // First try to fetch the data directly from the worker.
    if ($column == 'zip')       { $result = $this->zip($context, 'worker_node'); }
    elseif ($column == 'phone') { $result = $this->phone($context, 'worker_node'); }
    else                        { $result = $context['worker_node']->field_sirius_address['und'][0][$column]; }
    if ($result) { return $result; }

    // If the worker is QMSCO, we're done now.
    if ($this->is_qmsco($context)) { return ''; }

    // Otherwise, copy the data from the subscriber.
    if ($column == 'zip')       { $result = $this->zip($context, 'subscriber_node'); }
    elseif ($column == 'phone') { $result = $this->phone($context, 'subscriber_node'); }
    else                        { $result = $context['subscriber_node']->field_sirius_address['und'][0][$column]; }
    return $result;
  }

  public function mlk_acct($context, $which) {
    // For subscribers, we use this algorithm
    if ($this->is_subscriber($context) || ($which == 'subscriber_node')) {
      $id = $context['subscriber_node']->field_sirius_id3['und'][0]['value'];
      if (preg_match('/^U/', $id)) { return $id; }

      return $context['subscriber_node']->field_sirius_id['und'][0]['value'];
    }

    // For dependents, it's slightly different
    $id = $context['worker_node']->field_sirius_id2['und'][0]['value'];
    if (preg_match('/^U/', $id)) { return $id; }

    $id = $context['worker_node']->field_sirius_id3['und'][0]['value'];
    if (preg_match('/^U/', $id)) { return $id; }

    return $context['worker_node']->field_sirius_id['und'][0]['value'];
  }

  public function cobrastatus($context) {
    if ($this->is_cobra($context)) { return 'COBRA'; } else { return 'ACTIVE'; }
  }

  public function memdep($context) {
    if ($this->is_subscriber($context)) { return 'M'; }
    return 'D';
  }

  /**
    01 = Self (subscriber)
    05 = Domestic Partner
    06 = Protected Person, Child, Adopted Child, Step Child
    07 = Spouse
    08 = QMSCO Child"
  */

  public function deprel($context) {
    $reltype_id = $this->relationship_type($context['relationship_node']);
    if (!$reltype_id) { return '01'; }
    if (in_array($reltype_id, array('C', 'G', 'AC', 'H'))) { return '06'; }
    if (in_array($reltype_id, array('SP'))) { return '07'; }
    if (in_array($reltype_id, array('DP'))) { return '05'; }
    if (in_array($reltype_id, array('QMSCO'))) { return '08'; }
    return '';
  }

  public function gender($context) {
    $id = $this->gender_id($context['worker_node']);
    if ($id == 'M') { return 'M'; }
    if ($id == 'F') { return 'F'; }
    return 'U';
  }
}