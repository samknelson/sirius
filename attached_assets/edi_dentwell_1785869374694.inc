<?php

class Sirius_Smf_Report_Edi_Dentwell extends Sirius_Trust_Provider_Edi_Report_Generator {
  public $type = 'sirius-smf-edi-dentwell';

  public function benefit_nid() { return $this->benefit_nid_from_id('LADC'); }

  public function info($result = array()) {
    $result = array(
      'name' => t('EDI - Dentwell'),
      'description' => '',
      'access' => 'sirius trust staff',
      'module' => 'sirius_smf',
      'file' => 'reports/edi_dentwell.inc',
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

  public function edi_has_header() { return TRUE; }

  public function edi_render_header($report_id, $output = 'page') {
    $info = $this->info();
    $parameters = $this->parameters($report_id);
    $parameters = $parameters['parameters'];

    $header = array_keys($this->edi_fields('header'));

    $row['Record Type'] = 'H';
    $row['Group ID'] = '';
    $row['Report Date'] = date('Ymd', strtotime($parameters['asof_date']));

    return array('header' => $header, 'rows' => array($row));
  }

  public function edi_has_footer() { return TRUE; }

  public function edi_render_footer($report_id, $output = 'page') {
    $info = $this->info();
    $parameters = $this->parameters($report_id);
    $rowcount = $this->rowcount($report_id);

    $data = $this->load($report_id);

    $subscriber_count = $dependent_count = 0;
    foreach ($data as $record) {
      if ($record['edi_is_subscriber']) { ++$subscriber_count; } else { ++$dependent_count; }
    }

    $row['Record Type'] = 'T';
    $row['Subscriber Count'] = $subscriber_count;
    $row['Dependent Count'] = $dependent_count;

    $header = array_keys($this->edi_fields('footer'));

    return array('header' => $header, 'rows' => array($row));
  }

  public function edi_fields($which = '') {
    $fields = array();

    if ($which == 'header') {
      $fields['Record Type'] = array('width' => 1);
      $fields['Group ID'] = array('width' => 1);
      $fields['Report Date'] = array('width' => 1);
    } else if ($which != 'footer') {
      $fields['Record Type'] = array('width' => 1);
      $fields['SubscriberNumber'] = array('width' => 30);
      $fields['MemberType'] = array('width' => 3);
      $fields['EffectiveDate'] = array('width' => 8);
      $fields['TerminationDate'] = array('width' => 8);
      $fields['Status'] = array('width' => 30);
      $fields['LastName'] = array('width' => 35);
      $fields['FirstName'] = array('width' => 25);
      $fields['MiddleName'] = array('width' => 25);
      $fields['DateOfBirth'] = array('width' => 8);
      $fields['Address1'] = array('width' => 55);
      $fields['Address2'] = array('width' => 55);
      $fields['City'] = array('width' => 30);
      $fields['State'] = array('width' => 2);
      $fields['Zip'] = array('width' => 15);
      $fields['HomePhone'] = array('width' => 80);
      $fields['Email'] = array('width' => 80);
      $fields['Gender'] = array('width' => 1);
      $fields['RelationshipCode'] = array('width' => 3);
    } else {
      $fields['Record Type'] = array('width' => 1);
      $fields['Subscriber Count'] = array('width' => 1);
      $fields['Dependent Count'] = array('width' => 1);
    }

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

      $row['Record Type'] = 'E';
      $row['SubscriberNumber'] = $this->ssn($context, 'subscriber_node');
      $row['MemberType'] = $this->member_type($context);
      $row['EffectiveDate'] = $this->coverage_start_date($context);
      $row['TerminationDate'] = $this->coverage_end_date($context);
      $row['Status'] = '';
      $row['LastName'] = $context['worker_node']->field_sirius_name['und'][0]['family'];
      $row['FirstName'] = $context['worker_node']->field_sirius_name['und'][0]['given'];
      $row['MiddleName'] = $context['worker_node']->field_sirius_name['und'][0]['middle'];
      $row['DateOfBirth'] = $this->dob($context, 'worker_node');
      $row['Address1'] = $context['worker_node']->field_sirius_address['und'][0]['thoroughfare'];
      $row['Address2'] = $context['worker_node']->field_sirius_address['und'][0]['premise'];
      $row['City'] = $context['worker_node']->field_sirius_address['und'][0]['locality'];
      $row['State'] = $context['worker_node']->field_sirius_address['und'][0]['administrative_area'];
      $row['Zip'] = $this->zip($context, 'worker_node');
      $row['HomePhone'] = $this->phone($context, 'worker_node');
      $row['Email'] = $this->email($context, 'worker_node');
      $row['Gender'] = $this->gender($context);
      $row['RelationshipCode'] = $this->relationship_code($context);

      $row = $this->edi_row($row, $context);

      $rows[$context['pk']] = $row;
    }

    return array('is_multiple' => TRUE, 'rows' => $rows);
  }

  public function member_type($context) {
    if ($this->is_subscriber($context)) { return 'SUB'; }
    return 'DEP';
  }

  /**
    18 = Self (subscriber)
    01 = Spouse, Domestic Partner
    19 = Protected Person, Child, Adopted Child, Step Child, Handicapped Child
    08 = QMSCO Child"
  */

  public function relationship_code($context) {
    $reltype_id = $this->relationship_type($context['relationship_node']);
    if (!$reltype_id) { return '18'; }
    if (in_array($reltype_id, array('C', 'G', 'AC', 'H'))) { return '19'; }
    if (in_array($reltype_id, array('SP', 'DP'))) { return '01'; }
    if (in_array($reltype_id, array('QMSCO'))) { return '08'; }
    return '';
  }

  public function gender($context) {
    $id = $this->gender_id($context['worker_node']);
    if ($id == 'M') { return 'M'; }
    if ($id == 'F') { return 'F'; }
    return 'U';
  }

  public function division_id($context) {
    if ($this->is_cobra($context)) { return '09002'; }
    return '00002'; 
  }
}